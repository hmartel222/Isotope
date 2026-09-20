import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { parse } from 'yaml';
import {
  artifactPaths,
  readJsonArtifact,
  removeJsonArtifact,
  validateContract,
  writeJsonArtifact,
  type BDG,
  type CandidatePatch,
  type DiffReport,
  type EntryPoint,
  type FixturePair,
  type HarnessResult,
  type IsotopeConfig,
  type JsonValue,
  type PlannerModel,
  type ReasoningResult,
  type RepairVerification,
  type SelectedSpecs,
  type VerifiedRepair,
  type VerdictResult,
  type Signature,
} from '@isotope/core';
import { credentialsAvailable } from '@isotope/reasoner';
import { runHarness } from '@isotope/harness-ts';
import {
  allowedPathsFromBDG,
  assertRepositoryIntegrity,
  buildRepairPacket,
  evaluateRepairEligibility,
  generateDeterministicCandidate,
  planRepair,
  snapshotRepositoryIntegrity,
  validateCandidatePatch,
  withAppliedCandidate,
} from '@isotope/repair';
import { verifyRepair } from '@isotope/verifier';
import { loadFixturePair } from './fixtures';

export interface AttemptRepairInput {
  projectRoot: string;
  artifactProjectRoot: string;
  config: IsotopeConfig;
  selected: SelectedSpecs;
  bdg: BDG;
  entryPoint: EntryPoint;
  originalVerdict: VerdictResult;
  planning: { fixture: FixturePair; original: HarnessResult; newPayload: JsonValue; oldPayload: JsonValue };
  fixtureRoot: string;
  testFixtureDirectory?: string;
  diff?: DiffReport;
  reasoning?: ReasoningResult[];
  plannerModel?: PlannerModel;
  credentialsAvailable?: boolean;
  heldOutForbidden?: string[];
}
export interface AttemptRepairResult {
  attempted: boolean;
  reason: string;
  candidateRef: string | null;
  packetRef: string | null;
  packetHash: string | null;
  verification: RepairVerification | null;
  verifiedRepair: VerifiedRepair | null;
  output: string[];
  plannerInvocations: number;
}

async function heldOutFixture(input: AttemptRepairInput): Promise<FixturePair> {
  const spec = input.selected.specs[0]!; const id = spec.fixtures.heldout_pair;
  if (!id) throw new Error('held_out_fixture_required');
  const directory = input.testFixtureDirectory ? join(dirname(input.testFixtureDirectory), id) : join(input.fixtureRoot, id);
  return (await loadFixturePair({ directory, spec, pairId: id, role: 'held_out', synthetic: Boolean(input.testFixtureDirectory) })).fixture;
}
function rejected(input: AttemptRepairInput, repairId: string, reason: string, origin: 'deterministic' | 'model'): RepairVerification {
  return validateContract('RepairVerification', { schemaVersion: 1, repairId, entryPointId: input.entryPoint.id,
    specId: input.selected.specs[0]!.id, origin, outcome: 'patch_invalid', reason,
    planning: null, heldOut: null, shapeChecks: null, evidenceRefs: [] });
}

function emptyResult(reason: string, extra: Partial<AttemptRepairResult> = {}): AttemptRepairResult {
  return { attempted: false, reason, candidateRef: null, packetRef: null, packetHash: null, verification: null, verifiedRepair: null,
    output: extra.output ?? [`Repair: not attempted (${reason})`], plannerInvocations: extra.plannerInvocations ?? 0 };
}

async function persistCandidate(paths: ReturnType<typeof artifactPaths>, candidate: CandidatePatch): Promise<string> {
  const candidatePath = paths.candidate(candidate.repairId);
  await removeJsonArtifact(paths.root, paths.verifiedRepair);
  await removeJsonArtifact(paths.root, paths.verification(candidate.repairId));
  await writeJsonArtifact(paths.root, candidatePath, 'CandidatePatch', candidate);
  await writeJsonArtifact(paths.root, paths.proposal(candidate.repairId), 'CandidatePatch', candidate);
  return relative(paths.root, candidatePath).split('\\').join('/');
}

async function verifyApplied(input: AttemptRepairInput, candidate: CandidatePatch, allowedPaths: string[]): Promise<AttemptRepairResult> {
  const paths = artifactPaths(input.artifactProjectRoot);
  const candidateRef = await persistCandidate(paths, candidate);
  const integrity = await snapshotRepositoryIntegrity(input.projectRoot, allowedPaths);
  try {
    const heldOut = await heldOutFixture(input);
    const heldOutOriginal = await runHarness({ repoRoot: input.projectRoot, config: input.config, entryPoint: input.entryPoint,
      bdg: input.bdg, fixture: heldOut, codeVersion: 'original' });
    const result = await withAppliedCandidate({ repoRoot: input.projectRoot, repairId: candidate.repairId, candidate, allowedPaths,
      maxFiles: input.config.repair.maxFiles, maxChangedLines: input.config.repair.maxChangedLines }, applied => verifyRepair({
        repairId: candidate.repairId, workspaceRoot: applied.workspaceRoot, artifactRoot: input.artifactProjectRoot,
        candidate, candidateDiff: applied.diff, config: input.config, selectedSpecs: input.selected, originalBDG: input.bdg,
        entryPoint: input.entryPoint, originalVerdict: input.originalVerdict,
        planning: { fixture: input.planning.fixture, original: input.planning.original }, heldOut: { fixture: heldOut, original: heldOutOriginal } }));
    return { attempted: true, reason: result.verification.outcome, candidateRef, packetRef: null, packetHash: null, verification: result.verification,
      verifiedRepair: result.verifiedRepair, plannerInvocations: 0,
      output: result.verifiedRepair ? ['Repair: VERIFIED (offered only; checkout unchanged)', `Repair ID: ${candidate.repairId}`]
        : [`Repair: rejected (${result.verification.outcome})`, `Reason: ${result.verification.reason}`] };
  } catch (error) {
    const verification = rejected(input, candidate.repairId, String(error), candidate.origin);
    await writeJsonArtifact(paths.root, paths.verification(candidate.repairId), 'RepairVerification', verification);
    return { attempted: true, reason: 'patch_invalid', candidateRef, packetRef: null, packetHash: null, verification, verifiedRepair: null, plannerInvocations: 0,
      output: ['Repair: rejected (patch_invalid)', `Reason: ${String(error)}`] };
  } finally {
    await assertRepositoryIntegrity(input.projectRoot, integrity);
  }
}

export async function attemptDeterministicRepair(input: AttemptRepairInput): Promise<AttemptRepairResult> {
  return attemptRepair(input);
}

export async function attemptRepair(input: AttemptRepairInput): Promise<AttemptRepairResult> {
  const paths = artifactPaths(input.artifactProjectRoot); const spec = input.selected.specs[0]!;
  const credentials = input.credentialsAvailable ?? (Boolean(input.plannerModel) || credentialsAvailable());
  const eligibility = evaluateRepairEligibility({ verdict: input.originalVerdict, bdg: input.bdg, selectedSpecs: input.selected,
    config: input.config, fixture: input.planning.fixture, newPayload: input.planning.newPayload, credentialsAvailable: credentials });
  if (eligibility.route === 'none' || (!eligibility.eligible && eligibility.route !== 'model')) {
    return emptyResult(eligibility.reason);
  }
  if (eligibility.route === 'model' && !eligibility.eligible) {
    return emptyResult(eligibility.reason, { output: [`Repair: planner unavailable (${eligibility.reason})`] });
  }
  if (eligibility.route === 'deterministic' && eligibility.eligible && eligibility.changeIndex !== null) {
    const candidate = await generateDeterministicCandidate({ repoRoot: input.projectRoot, bdg: input.bdg, spec,
      entryPointId: input.entryPoint.id, siteIds: eligibility.siteIds, changeIndex: eligibility.changeIndex });
    return verifyApplied(input, candidate, allowedPathsFromBDG(input.bdg, input.entryPoint.id));
  }
  if (eligibility.route !== 'model' || !eligibility.eligible) return emptyResult(eligibility.reason);
  if (!input.diff) return emptyResult('planner_requires_diff');
  const built = await buildRepairPacket({
    repoRoot: input.projectRoot, spec, bdg: input.bdg, entryPoint: input.entryPoint, diff: input.diff, verdict: input.originalVerdict,
    old: input.planning.original.old[0], new: input.planning.original.new[0], oldPayload: input.planning.oldPayload, newPayload: input.planning.newPayload,
    redact: input.config.repair.redact, maxFiles: input.config.repair.maxFiles, maxChangedLines: input.config.repair.maxChangedLines,
    ...(input.reasoning ? { reasoning: input.reasoning } : {}),
    heldOutForbidden: [...(input.heldOutForbidden ?? []), spec.fixtures.heldout_pair ?? '', 'sub_heldout', 'sub_HELDOUT_UNIQUE', '987654321'],
  });
  if (!built.ok) return emptyResult(built.reason, { output: [`Repair: planner packet not built (${built.reason})`] });
  const repairId = `mdl-${createHash('sha256').update(built.hash).digest('hex').slice(0, 16)}`;
  const packetPath = paths.repairPacket(repairId);
  await writeJsonArtifact(paths.root, packetPath, 'RepairPacket', built.packet);
  const packetRef = relative(paths.root, packetPath).split('\\').join('/');
  const planOnce = (hint?: string) => planRepair({
    packet: built.packet, config: input.config.repair, repairId,
    ...(input.plannerModel ? { model: input.plannerModel } : {}),
    credentials, ...(hint ? { mechanicalRetryHint: hint } : {}),
  });
  let candidate: CandidatePatch;
  let plannerInvocations = 0;
  try {
    candidate = await planOnce();
    plannerInvocations = 1;
  } catch (error) {
    return emptyResult(String(error), { output: [`Repair: planner unavailable (${String(error)})`] });
  }
  const plannerDeclined = candidate.classification !== 'repair_candidate' || !candidate.patch
    || candidate.abstain || candidate.confidence === 'low' || candidate.suspectedInjection;
  if (plannerDeclined) {
    const candidateRef = await persistCandidate(paths, candidate);
    const kind = candidate.suspectedInjection ? 'injection' : candidate.abstain ? 'abstain' : candidate.confidence === 'low' ? 'low confidence'
      : candidate.classification;
    return { attempted: true, reason: candidate.classification, candidateRef, packetRef, packetHash: built.hash, verification: null, verifiedRepair: null, plannerInvocations,
      output: [`Repair: planner declined (${kind})`, candidate.summary] };
  }
  const allowedPaths = built.packet.constraints.allowedPaths;
  try { await validateCandidatePatch({ repoRoot: input.projectRoot, candidate, allowedPaths, maxFiles: input.config.repair.maxFiles, maxChangedLines: input.config.repair.maxChangedLines }); }
  catch (error) {
    candidate = await planOnce(String(error));
    plannerInvocations += 1;
    if (candidate.classification !== 'repair_candidate' || !candidate.patch) {
      const candidateRef = await persistCandidate(paths, candidate);
      return { attempted: true, reason: candidate.classification, candidateRef, packetRef, packetHash: built.hash, verification: null, verifiedRepair: null, plannerInvocations,
        output: ['Repair: planner declined after mechanical retry', candidate.summary] };
    }
  }
  const verified = await verifyApplied(input, candidate, allowedPaths);
  return { ...verified, packetRef, packetHash: built.hash, plannerInvocations, output: verified.output };
}

export async function explainRepair(options: { configPath: string; repairId: string }): Promise<{ exitCode: 0 | 10; output: string }> {
  const configAbsolute = resolve(options.configPath); const projectRoot = dirname(configAbsolute); const paths = artifactPaths(projectRoot);
  const lines = [`Repair explain: ${options.repairId}`];
  try {
    const packet = await readJsonArtifact(paths.root, paths.repairPacket(options.repairId), 'RepairPacket');
    lines.push(`RepairPacket hash: ${createHash('sha256').update(JSON.stringify(packet)).digest('hex')}`);
    lines.push(`Verdict: ${packet.verdict.type}`);
    lines.push(`Allowed paths: ${packet.constraints.allowedPaths.join(', ')}`);
  } catch { lines.push('RepairPacket: absent'); }
  try {
    const candidate = await readJsonArtifact(paths.root, paths.candidate(options.repairId), 'CandidatePatch');
    lines.push(`Planner classification: ${candidate.classification}`);
    lines.push(`Origin: ${candidate.origin}`);
    lines.push(`Summary: ${candidate.summary}`);
    if (candidate.classification === 'repair_candidate' && candidate.patch) {
      lines.push(`Files: ${candidate.patch.files.map(file => file.path).join(', ')}`);
    }
  } catch { lines.push('Candidate: absent'); }
  try {
    const verification = await readJsonArtifact(paths.root, paths.verification(options.repairId), 'RepairVerification');
    lines.push(`Verification outcome: ${verification.outcome}`);
    lines.push(`Held-out: ${verification.heldOut ? verification.heldOut.verdict.verdict : 'n/a'}`);
    if (verification.shapeChecks) lines.push(`Shape checks: ${JSON.stringify(verification.shapeChecks)}`);
  } catch { lines.push('Verification: absent'); }
  try {
    const verified = await readJsonArtifact(paths.root, paths.verifiedRepair, 'VerifiedRepair');
    if (verified.repairId === options.repairId) lines.push('Verified repair: offered only (checkout unchanged)');
  } catch { /* optional */ }
  if (lines.length <= 1) throw new Error(`No repair artifacts for ${options.repairId}`);
  return { exitCode: 0, output: lines.join('\n') };
}

export async function repairExistingFailure(options: { configPath: string; entryPoint: string; testFixtureDirectory?: string }): Promise<{ exitCode: 1 | 5; output: string }> {
  const configAbsolute = resolve(options.configPath); const projectRoot = dirname(configAbsolute); const paths = artifactPaths(projectRoot);
  const config = validateContract('IsotopeConfig', parse(await readFile(configAbsolute, 'utf8')) as unknown);
  const [selected, bdg, verdict, report] = await Promise.all([
    readJsonArtifact(paths.root, paths.selectedSpecs, 'SelectedSpecs'), readJsonArtifact(paths.root, paths.bdg, 'BDG'),
    readJsonArtifact(paths.root, paths.verdict, 'VerdictReport'), readJsonArtifact(paths.root, paths.report, 'IsotopeReport'),
  ]);
  const entry = bdg.entryPoints.find(item => item.id === options.entryPoint || `${item.file}#${item.export}` === options.entryPoint || (bdg.entryPoints.length === 1 && item.export === options.entryPoint));
  if (!entry) throw new Error(`Entry point not present in existing BDG: ${options.entryPoint}`);
  const result = verdict.results.find(item => item.entryPointId === entry.id);
  if (!result || (result.verdict !== 'FAIL' && result.verdict !== 'FAIL_REASONED')) throw new Error('isotope repair requires an existing FAIL or FAIL_REASONED artifact');
  const spec = selected.specs[0]!; const pairId = config.fixturePair ?? spec.fixtures.pair;
  const fixtureDirectory = options.testFixtureDirectory ?? join(projectRoot, 'fixtures/normalized', pairId);
  const loaded = await loadFixturePair({ directory: fixtureDirectory, spec, pairId, role: 'planning', synthetic: Boolean(options.testFixtureDirectory) });
  const { fixture, payloads: [oldPayload, newPayload] } = loaded;
  const signatures: Signature[] = [];
  for (const artifactRef of report.signatureRefs) signatures.push(await readJsonArtifact(paths.root, resolve(paths.root, artifactRef), 'Signature'));
  const pair = (payloadVersion: string): [Signature, Signature] => {
    const matches = signatures.filter(signature => signature.entryPointId === entry.id && signature.codeVersion === 'original' && signature.payloadVersion === payloadVersion).sort((a, b) => a.runIndex - b.runIndex);
    if (matches.length !== 2) throw new Error(`Existing FAIL artifacts need two ${payloadVersion} signatures`);
    return [matches[0]!, matches[1]!];
  };
  const diff = report.diffReportRefs[0] ? await readJsonArtifact(paths.root, resolve(paths.root, report.diffReportRefs[0]), 'DiffReport') : undefined;
  const reasoning: ReasoningResult[] = [];
  for (const ref of report.reasoningRefs) reasoning.push(await readJsonArtifact(paths.root, resolve(paths.root, ref), 'ReasoningResult'));
  const repair = await attemptRepair({ projectRoot, artifactProjectRoot: projectRoot, config, selected, bdg, entryPoint: entry, originalVerdict: result,
    planning: { fixture, original: { old: pair(fixture.oldVersion), new: pair(fixture.newVersion) }, oldPayload: oldPayload!, newPayload: newPayload! },
    fixtureRoot: join(projectRoot, 'fixtures/normalized'), ...(options.testFixtureDirectory ? { testFixtureDirectory: options.testFixtureDirectory } : {}),
    ...(diff ? { diff } : {}), ...(reasoning.length ? { reasoning } : {}) });
  const updated = validateContract('IsotopeReport', { ...report, candidateRefs: repair.candidateRef ? [repair.candidateRef] : [],
    repairPacketRefs: repair.packetRef ? [repair.packetRef] : report.repairPacketRefs,
    repairVerifications: repair.verification ? [repair.verification] : [], verifiedRepairs: repair.verifiedRepair ? [repair.verifiedRepair] : [] });
  await writeJsonArtifact(paths.root, paths.report, 'IsotopeReport', updated);
  return { exitCode: repair.verifiedRepair ? 5 : 1, output: [`Original verdict: ${result.verdict}`, ...repair.output, `Artifacts: ${paths.root}`].join('\n') };
}
