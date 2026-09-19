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
  type EntryPoint,
  type FixturePair,
  type HarnessResult,
  type IsotopeConfig,
  type JsonValue,
  type RepairVerification,
  type SelectedSpecs,
  type VerifiedRepair,
  type VerdictResult,
  type Signature,
} from '@isotope/core';
import { runHarness } from '@isotope/harness-ts';
import {
  allowedPathsFromBDG,
  assertRepositoryIntegrity,
  evaluateRepairEligibility,
  generateDeterministicCandidate,
  snapshotRepositoryIntegrity,
  withAppliedCandidate,
} from '@isotope/repair';
import { verifyRepair } from '@isotope/verifier';

export interface AttemptRepairInput {
  projectRoot: string;
  artifactProjectRoot: string;
  config: IsotopeConfig;
  selected: SelectedSpecs;
  bdg: BDG;
  entryPoint: EntryPoint;
  originalVerdict: VerdictResult;
  planning: { fixture: FixturePair; original: HarnessResult; newPayload: JsonValue };
  fixtureRoot: string;
  testFixtureDirectory?: string;
}
export interface AttemptRepairResult {
  attempted: boolean;
  reason: string;
  candidateRef: string | null;
  verification: RepairVerification | null;
  verifiedRepair: VerifiedRepair | null;
  output: string[];
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function fixtureVersion(value: unknown, label: string): string {
  const event = asObject(value, label); const data = asObject(event.data, `${label}.data`); const object = asObject(data.object, `${label}.data.object`);
  if (event.object !== 'event' || event.type !== 'customer.subscription.updated' || typeof event.api_version !== 'string' || !event.api_version || object.object !== 'subscription') throw new Error(`${label}: expected Stripe subscription event`);
  return event.api_version;
}
async function heldOutFixture(input: AttemptRepairInput): Promise<FixturePair> {
  const spec = input.selected.specs[0]!; const id = spec.fixtures.heldout_pair;
  if (!id) throw new Error('held_out_fixture_required');
  const directory = input.testFixtureDirectory ? join(dirname(input.testFixtureDirectory), id) : join(input.fixtureRoot, id);
  const oldPath = resolve(directory, 'old.json'); const newPath = resolve(directory, 'new.json'); const metaPath = resolve(directory, 'meta.json');
  const [oldText, newText, metaText] = await Promise.all([oldPath, newPath, metaPath].map(path => readFile(path, 'utf8')));
  const old = JSON.parse(oldText!) as unknown; const next = JSON.parse(newText!) as unknown; const meta = asObject(JSON.parse(metaText!), 'held-out metadata');
  if (input.testFixtureDirectory && meta.synthetic !== true) throw new Error('Test held-out fixtures must declare meta.synthetic: true');
  if (!input.testFixtureDirectory && meta.synthetic === true) throw new Error('Synthetic held-out fixtures are forbidden in product fixture directories');
  return { id: input.testFixtureDirectory ? `synthetic-${id}` : id, role: 'held_out', oldPath, newPath,
    oldVersion: fixtureVersion(old, 'held-out old fixture'), newVersion: fixtureVersion(next, 'held-out new fixture') };
}
function rejected(input: AttemptRepairInput, repairId: string, reason: string): RepairVerification {
  return validateContract('RepairVerification', { schemaVersion: 1, repairId, entryPointId: input.entryPoint.id,
    specId: input.selected.specs[0]!.id, origin: 'deterministic', outcome: 'patch_invalid', reason,
    planning: null, heldOut: null, shapeChecks: null, evidenceRefs: [] });
}

export async function attemptDeterministicRepair(input: AttemptRepairInput): Promise<AttemptRepairResult> {
  const paths = artifactPaths(input.artifactProjectRoot); const spec = input.selected.specs[0]!;
  const eligibility = evaluateRepairEligibility({ verdict: input.originalVerdict, bdg: input.bdg, selectedSpecs: input.selected,
    config: input.config, fixture: input.planning.fixture, newPayload: input.planning.newPayload });
  if (!eligibility.eligible || eligibility.changeIndex === null) return { attempted: false, reason: eligibility.reason, candidateRef: null,
    verification: null, verifiedRepair: null, output: [`Repair: not attempted (${eligibility.reason})`] };
  const candidate = await generateDeterministicCandidate({ repoRoot: input.projectRoot, bdg: input.bdg, spec,
    entryPointId: input.entryPoint.id, siteIds: eligibility.siteIds, changeIndex: eligibility.changeIndex });
  const candidatePath = paths.candidate(candidate.repairId); await removeJsonArtifact(paths.root, paths.verifiedRepair);
  await removeJsonArtifact(paths.root, paths.verification(candidate.repairId));
  await writeJsonArtifact(paths.root, candidatePath, 'CandidatePatch', candidate);
  const allowedPaths = allowedPathsFromBDG(input.bdg, input.entryPoint.id);
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
    return { attempted: true, reason: result.verification.outcome, candidateRef: relative(paths.root, candidatePath).split('\\').join('/'),
      verification: result.verification, verifiedRepair: result.verifiedRepair,
      output: result.verifiedRepair ? ['Repair: VERIFIED (offered only; checkout unchanged)', `Repair ID: ${candidate.repairId}`]
        : [`Repair: rejected (${result.verification.outcome})`, `Reason: ${result.verification.reason}`] };
  } catch (error) {
    const verification = rejected(input, candidate.repairId, String(error));
    await writeJsonArtifact(paths.root, paths.verification(candidate.repairId), 'RepairVerification', verification);
    return { attempted: true, reason: 'patch_invalid', candidateRef: relative(paths.root, candidatePath).split('\\').join('/'),
      verification, verifiedRepair: null, output: ['Repair: rejected (patch_invalid)', `Reason: ${String(error)}`] };
  } finally {
    await assertRepositoryIntegrity(input.projectRoot, integrity);
  }
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
  if (!result || result.verdict !== 'FAIL') throw new Error('isotope repair requires an existing mechanical FAIL artifact');
  const spec = selected.specs[0]!; const fixtureDirectory = options.testFixtureDirectory ?? join(projectRoot, 'fixtures/normalized', spec.fixtures.pair);
  const oldPath = resolve(fixtureDirectory, 'old.json'); const newPath = resolve(fixtureDirectory, 'new.json');
  const [oldPayload, newPayload] = await Promise.all([oldPath, newPath].map(async path => JSON.parse(await readFile(path, 'utf8')) as JsonValue));
  const fixture: FixturePair = { id: options.testFixtureDirectory ? `synthetic-${spec.fixtures.pair}` : spec.fixtures.pair, role: 'planning', oldPath, newPath,
    oldVersion: fixtureVersion(oldPayload, 'old fixture'), newVersion: fixtureVersion(newPayload, 'new fixture') };
  const signatures: Signature[] = [];
  for (const artifactRef of report.signatureRefs) signatures.push(await readJsonArtifact(paths.root, resolve(paths.root, artifactRef), 'Signature'));
  const pair = (payloadVersion: string): [Signature, Signature] => {
    const matches = signatures.filter(signature => signature.entryPointId === entry.id && signature.codeVersion === 'original' && signature.payloadVersion === payloadVersion).sort((a, b) => a.runIndex - b.runIndex);
    if (matches.length !== 2) throw new Error(`Existing FAIL artifacts need two ${payloadVersion} signatures`);
    return [matches[0]!, matches[1]!];
  };
  const repair = await attemptDeterministicRepair({ projectRoot, artifactProjectRoot: projectRoot, config, selected, bdg, entryPoint: entry, originalVerdict: result,
    planning: { fixture, original: { old: pair(fixture.oldVersion), new: pair(fixture.newVersion) }, newPayload: newPayload! },
    fixtureRoot: join(projectRoot, 'fixtures/normalized'), ...(options.testFixtureDirectory ? { testFixtureDirectory: options.testFixtureDirectory } : {}) });
  const updated = validateContract('IsotopeReport', { ...report, candidateRefs: repair.candidateRef ? [repair.candidateRef] : [],
    repairVerifications: repair.verification ? [repair.verification] : [], verifiedRepairs: repair.verifiedRepair ? [repair.verifiedRepair] : [] });
  await writeJsonArtifact(paths.root, paths.report, 'IsotopeReport', updated);
  return { exitCode: repair.verifiedRepair ? 5 : 1, output: [`Original verdict: FAIL`, ...repair.output, `Artifacts: ${paths.root}`].join('\n') };
}
