import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import {
  artifactPaths,
  needsSemanticReasoning,
  removeJsonArtifact,
  resolveVerdict,
  validateContract,
  writeJsonArtifact,
  type BDG,
  type CandidatePatch,
  type FixturePair,
  type HarnessResult,
  type JsonValue,
  type ReasoningRun,
  type RepairOutcome,
  type RepairVerification,
  type RepairVerificationInput,
  type VerificationPairResult,
  type VerifiedRepair,
} from '@isotope/core';
import { checkDeterminism, diffSignatures } from '@isotope/differ';
import { runHarness } from '@isotope/harness-ts';
import { resolveBehavioralDependencyGraph } from '@isotope/resolver-ts';
import { reasonAboutEntryPoint } from '@isotope/reasoner';

interface PairEvidence { result: VerificationPairResult }

function ref(root: string, path: string): string { return relative(root, path).split('\\').join('/'); }
function passing(result: VerificationPairResult): boolean {
  return result.stable && result.secondaryStable && result.baselineEquivalent && (result.verdict.verdict === 'PASS' || result.verdict.verdict === 'PASS_REASONED');
}

async function verifyPair(input: RepairVerificationInput, fixture: FixturePair, original: HarnessResult, role: 'planning' | 'held_out', postBDG: BDG): Promise<PairEvidence> {
  const paths = artifactPaths(input.artifactRoot);
  for (const signature of [...original.old, ...original.new]) await writeJsonArtifact(paths.root, paths.signature(signature), 'Signature', signature);
  const patched = await runHarness({ repoRoot: input.workspaceRoot, config: input.config, entryPoint: input.entryPoint, bdg: postBDG, fixture, codeVersion: `patched:${input.repairId}` });
  for (const signature of [...patched.old, ...patched.new]) await writeJsonArtifact(paths.root, paths.signature(signature), 'Signature', signature);
  // Mandatory authority: immutable original-old baseline versus patched-new candidate.
  const baselineDiff = diffSignatures({ old: original.old[0], new: patched.new[0], bdg: postBDG, selfComparisons: { old: original.old, new: patched.new } });
  // Secondary guard only: patched-old versus patched-new cannot replace the baseline comparison.
  const secondaryDiff = diffSignatures({ old: patched.old[0], new: patched.new[0], bdg: postBDG, selfComparisons: patched });
  const baselinePath = paths.comparison(input.entryPoint.id, `patched:${input.repairId}`, fixture.id, 'baseline');
  const secondaryPath = paths.comparison(input.entryPoint.id, `patched:${input.repairId}`, fixture.id, 'secondary');
  await writeJsonArtifact(paths.root, baselinePath, 'DiffReport', baselineDiff);
  await writeJsonArtifact(paths.root, secondaryPath, 'DiffReport', secondaryDiff);
  let reasoning: ReasoningRun | null = null;
  if (needsSemanticReasoning(baselineDiff) && input.config.reasoner.mode === 'on') {
    const spec = input.selectedSpecs.specs[0]!;
    const [oldPayload, newPayload] = await Promise.all([fixture.oldPath, fixture.newPath].map(async path => JSON.parse(await readFile(path, 'utf8')) as JsonValue));
    const semantic = await reasonAboutEntryPoint({
      repoRoot: input.workspaceRoot, artifactRoot: input.artifactRoot, spec, bdg: postBDG, entryPoint: input.entryPoint, diff: baselineDiff,
      old: original.old[0], new: patched.new[0], oldPayload, newPayload, config: input.config, remainingInvocations: input.config.reasoner.maxInvocations,
    });
    reasoning = semantic.run;
  }
  const verdict = resolveVerdict({ entryPoint: input.entryPoint, bdg: postBDG, diff: baselineDiff, reasoning, config: input.config });
  const secondaryVerdict = resolveVerdict({ entryPoint: input.entryPoint, bdg: postBDG, diff: secondaryDiff, reasoning: null, config: input.config });
  const stable = checkDeterminism(patched.old).stable && checkDeterminism(patched.new).stable;
  const secondaryStable = (secondaryVerdict.verdict === 'PASS' || secondaryVerdict.verdict === 'PASS_REASONED') && secondaryDiff.stable && !secondaryDiff.divergences.some(divergence => divergence.kind === 'unstable');
  const baselineEquivalent = (verdict.verdict === 'PASS' && baselineDiff.divergences.every(divergence => divergence.tier === 'mechanical' && divergence.severity === 'info'))
    || verdict.verdict === 'PASS_REASONED';
  const signatureRef = (signature: HarnessResult['old'][number]) => ({ path: ref(paths.root, paths.signature(signature)), codeVersion: signature.codeVersion, payloadVersion: signature.payloadVersion, fixturePair: signature.fixturePair, runIndex: signature.runIndex });
  const result = validateContract('VerificationPairResult', {
    role, fixturePair: fixture.id, baseline: signatureRef(original.old[0]),
    patchedOld: patched.old.map(signatureRef), patchedNew: patched.new.map(signatureRef),
    baselineDiffRef: ref(paths.root, baselinePath), secondaryDiffRef: ref(paths.root, secondaryPath), verdict,
    stable, baselineEquivalent, secondaryStable,
  });
  return { result };
}

function primitives(value: unknown, output = new Set<string>()): Set<string> {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') output.add(`${typeof value}:${String(value)}`);
  else if (Array.isArray(value)) for (const item of value) primitives(item, output);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) primitives(item, output);
  return output;
}
function introducedLiterals(candidate: CandidatePatch): Set<string> {
  const values = new Set<string>();
  if (candidate.classification !== 'repair_candidate' || !candidate.patch) return values;
  for (const file of candidate.patch.files) for (const edit of file.edits) {
    const stripped = edit.replacement.replace(edit.anchor, '');
    for (const match of stripped.matchAll(/(?:^|[^\w.])(-?\d+(?:\.\d+)?)(?![\w.])/g)) values.add(`number:${Number(match[1])}`);
    for (const match of stripped.matchAll(/(['"])(.*?)\1/g)) values.add(`string:${match[2]}`);
    for (const match of stripped.matchAll(/\b(true|false)\b/g)) values.add(`boolean:${match[1]}`);
  }
  return values;
}
function newSuppression(candidate: CandidatePatch): boolean {
  if (candidate.classification !== 'repair_candidate' || !candidate.patch) return false;
  return candidate.patch.files.some(file => file.edits.some(edit => !/\bas\s+(?:any|unknown)\b|@ts-ignore|@ts-expect-error/.test(edit.anchor)
    && /\bas\s+(?:any|unknown)\b|@ts-ignore|@ts-expect-error/.test(edit.replacement)));
}
async function baselineValues(input: RepairVerificationInput): Promise<Set<string>> {
  const baseline = input.planning.original.old[0];
  const values = primitives({ returned: baseline.returned, threw: baseline.threw, calls: baseline.calls.map(call => ({ mock: call.mock, sinkKind: call.sinkKind, args: call.args })) });
  for (const fixture of [input.planning.fixture, input.heldOut.fixture]) {
    const payload = JSON.parse(await readFile(fixture.oldPath, 'utf8')) as JsonValue; primitives(payload, values);
  }
  return values;
}
async function shapeChecks(input: RepairVerificationInput, post: BDG) {
  const originalSites = input.originalBDG.affectedSites.filter(site => site.entryPointId === input.entryPoint.id && site.provenance.confidence !== 'low');
  const originalSinkNames = new Set(originalSites.flatMap(site => site.sinkNodeIds).map(id => input.originalBDG.sinks.find(sink => sink.nodeId === id)?.name).filter((name): name is string => Boolean(name)));
  const postRoots = post.nodes.filter(node => node.entryPointId === input.entryPoint.id && node.kind === 'taint_root' && node.provenance.confidence !== 'low');
  const postSites = post.affectedSites.filter(site => site.entryPointId === input.entryPoint.id && site.provenance.confidence !== 'low');
  const postSinkNames = new Set(post.sinks.filter(sink => post.nodes.some(node => node.id === sink.nodeId && node.entryPointId === input.entryPoint.id)).map(sink => sink.name));
  const flowNames = new Set(postSites.flatMap(site => site.sinkNodeIds).map(id => post.sinks.find(sink => sink.nodeId === id)?.name).filter((name): name is string => Boolean(name)));
  const observed = await baselineValues(input); const added = introducedLiterals(input.candidate);
  return {
    providerSinkFlowPreserved: originalSinkNames.size > 0 && [...originalSinkNames].every(name => flowNames.has(name)),
    sinksPreserved: originalSinkNames.size > 0 && [...originalSinkNames].every(name => postSinkNames.has(name)),
    noBaselineLiteralIntroduced: ![...added].some(value => observed.has(value)),
    taintRootReachable: postRoots.length > 0,
    noNewSuppression: !newSuppression(input.candidate),
  };
}
function allShapeChecksPass(checks: Awaited<ReturnType<typeof shapeChecks>>): boolean { return Object.values(checks).every(Boolean); }

function rejected(input: RepairVerificationInput, outcome: Exclude<RepairOutcome, 'verified'>, reason: string, planning: VerificationPairResult | null, heldOut: VerificationPairResult | null, checks: Awaited<ReturnType<typeof shapeChecks>> | null): RepairVerification {
  return validateContract('RepairVerification', { schemaVersion: 1, repairId: input.repairId, entryPointId: input.entryPoint.id,
    specId: input.selectedSpecs.specs[0]!.id, origin: input.candidate.origin, outcome, reason, planning, heldOut, shapeChecks: checks,
    evidenceRefs: input.candidate.evidenceRefs });
}

/** Re-entrant L10 verifier. CandidatePatch has no authority before this function succeeds. */
export async function verifyRepair(input: RepairVerificationInput): Promise<{ verification: RepairVerification; verifiedRepair: VerifiedRepair | null }> {
  if (input.originalVerdict.verdict !== 'FAIL') throw new Error('Repair verification requires an original mechanical FAIL');
  if (input.candidate.classification !== 'repair_candidate' || !input.candidate.patch || input.candidate.repairId !== input.repairId) throw new Error('Repair verification requires the matching candidate patch');
  const paths = artifactPaths(input.artifactRoot); await removeJsonArtifact(paths.root, paths.verifiedRepair);
  const spec = input.selectedSpecs.specs[0]; if (!spec) throw new Error('Repair verification requires one ChangeSpec');
  const postBDG = await resolveBehavioralDependencyGraph({ repositoryRoot: input.workspaceRoot, config: input.config, changeSpec: spec });
  let planning: PairEvidence;
  try { planning = await verifyPair(input, input.planning.fixture, input.planning.original, 'planning', postBDG); }
  catch (error) {
    const verification = rejected(input, 'patch_invalid', `patched execution failed: ${String(error)}`, null, null, null);
    await writeJsonArtifact(paths.root, paths.verification(input.repairId), 'RepairVerification', verification); return { verification, verifiedRepair: null };
  }
  if (!planning.result.stable) {
    const verification = rejected(input, 'patch_introduced_nondeterminism', 'Patched planning behavior was unstable', planning.result, null, null);
    await writeJsonArtifact(paths.root, paths.verification(input.repairId), 'RepairVerification', verification); return { verification, verifiedRepair: null };
  }
  if (!passing(planning.result)) {
    const verification = rejected(input, 'did_not_restore_behavior', 'Patched new behavior did not restore the immutable original-old baseline', planning.result, null, null);
    await writeJsonArtifact(paths.root, paths.verification(input.repairId), 'RepairVerification', verification); return { verification, verifiedRepair: null };
  }
  let heldOut: PairEvidence;
  try { heldOut = await verifyPair(input, input.heldOut.fixture, input.heldOut.original, 'held_out', postBDG); }
  catch (error) {
    const verification = rejected(input, 'overfit_rejected', `Held-out execution failed: ${String(error)}`, planning.result, null, null);
    await writeJsonArtifact(paths.root, paths.verification(input.repairId), 'RepairVerification', verification); return { verification, verifiedRepair: null };
  }
  if (!heldOut.result.stable) {
    const verification = rejected(input, 'patch_introduced_nondeterminism', 'Patched held-out behavior was unstable', planning.result, heldOut.result, null);
    await writeJsonArtifact(paths.root, paths.verification(input.repairId), 'RepairVerification', verification); return { verification, verifiedRepair: null };
  }
  if (!passing(heldOut.result)) {
    const verification = rejected(input, 'overfit_rejected', 'Candidate passed planning evidence but failed the held-out provider fixture', planning.result, heldOut.result, null);
    await writeJsonArtifact(paths.root, paths.verification(input.repairId), 'RepairVerification', verification); return { verification, verifiedRepair: null };
  }
  const checks = await shapeChecks(input, postBDG);
  if (!allShapeChecksPass(checks)) {
    const verification = rejected(input, 'degenerate_patch', 'Patched behavior passed but structural anti-cheat constraints failed', planning.result, heldOut.result, checks);
    await writeJsonArtifact(paths.root, paths.verification(input.repairId), 'RepairVerification', verification); return { verification, verifiedRepair: null };
  }
  const verification = validateContract('RepairVerification', { schemaVersion: 1, repairId: input.repairId, entryPointId: input.entryPoint.id,
    specId: spec.id, origin: input.candidate.origin, outcome: 'verified', reason: 'Independently verified against planning and held-out provider contracts',
    planning: planning.result, heldOut: heldOut.result, shapeChecks: checks, evidenceRefs: input.candidate.evidenceRefs });
  const candidate = input.candidate;
  if (candidate.confidence === 'low' || candidate.suspectedInjection || candidate.abstain) throw new Error('Verified repair requires a non-abstaining authoritative candidate');
  const verifiedRepair = validateContract('VerifiedRepair', { schemaVersion: 1, repairId: input.repairId, entryPointId: input.entryPoint.id,
    specId: spec.id, candidate: { ...candidate, confidence: candidate.confidence }, verification, diff: input.candidateDiff, offeredOnly: true });
  await writeJsonArtifact(paths.root, paths.verification(input.repairId), 'RepairVerification', verification);
  await writeJsonArtifact(paths.root, paths.verifiedRepair, 'VerifiedRepair', verifiedRepair);
  return { verification, verifiedRepair };
}
