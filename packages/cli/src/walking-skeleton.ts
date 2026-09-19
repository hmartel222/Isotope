import { readFile, realpath } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { parse } from 'yaml';
import { artifactPaths, readJsonArtifact, removeJsonArtifact, writeJsonArtifact, validateContract, resolveVerdict,
  type DiffReport, type FixturePair, type HarnessResult, type IsotopeReport, type VerdictResult } from '@isotope/core';
import { loadWalkingSkeletonSpec } from '@isotope/changespec';
import { createTsHarnessPlan, runTsHarness, HarnessExecutionError } from '@isotope/harness-ts';
import { checkDeterminism, diffSignatures } from '@isotope/differ';

export interface WalkingSkeletonOptions {
  configPath: string;
  artifactProjectRoot?: string;
  disableReasoner?: boolean;
  disableRepair?: boolean;
  /** Internal tests only. Must contain meta.synthetic=true; never falls back implicitly. */
  testFixtureDirectory?: string;
}
export interface WalkingSkeletonResult {
  exitCode: 0 | 1 | 3 | 4; output: string; report: IsotopeReport;
  signatures: HarnessResult | null; diff: DiffReport | null;
}
function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function isHttp200(value: unknown): boolean { return value !== null && typeof value === 'object' && 'status' in value && value.status === 200; }
function fixtureVersion(value: unknown, label: string): string {
  const event = asObject(value, label);
  const data = asObject(event.data, `${label}.data`);
  const subscription = asObject(data.object, `${label}.data.object`);
  if (event.object !== 'event' || event.type !== 'customer.subscription.updated' || typeof event.api_version !== 'string' || !event.api_version || subscription.object !== 'subscription' || typeof subscription.id !== 'string') throw new Error(`${label}: expected a versioned Stripe subscription.updated event envelope`);
  return event.api_version;
}

/** PHASE 2: spec selection, explicit scope and BDG are static; execution/verdict are real. */
export async function verifyWalkingSkeleton(options: WalkingSkeletonOptions): Promise<WalkingSkeletonResult> {
  const configPath = await realpath(resolve(options.configPath));
  const projectRoot = dirname(configPath);
  const sourceRoot = resolve(__dirname, '../../..');
  const config = validateContract('IsotopeConfig', parse(await readFile(configPath, 'utf8')) as unknown);
  if (options.disableReasoner) config.reasoner.mode = 'off';
  if (options.disableRepair) config.repair.mode = 'off';
  if (config.language !== 'ts' || config.entryPoints.length !== 1) throw new Error('Phase 2 verify requires exactly one explicit TypeScript entry point');
  if (config.reasoner.mode !== 'off' || config.repair.mode !== 'off') throw new Error('Phase 2 verify requires reasoner.mode: off and repair.mode: off; neither stage is implemented');
  const selected = await loadWalkingSkeletonSpec(join(sourceRoot, 'specs'));
  const spec = selected.specs[0]!;
  const bdg = validateContract('BDG', JSON.parse(await readFile(join(projectRoot, 'bdg.stub.json'), 'utf8')) as unknown);
  const entryPoint = bdg.entryPoints[0]; const configured = config.entryPoints[0]!;
  if (bdg.entryPoints.length !== 1 || !entryPoint || entryPoint.file !== configured.file || entryPoint.export !== configured.export || entryPoint.kind !== configured.kind || entryPoint.kind !== 'express_route' || entryPoint.language !== 'ts') throw new Error('Static Phase 2 BDG must match the single configured express_route entry point');
  if (!bdg.affectedSites.length || bdg.affectedSites.some(site => site.specId !== spec.id || site.entryPointId !== entryPoint.id)) throw new Error('Static BDG affected sites must reference the selected spec and entry point');
  const synthetic = options.testFixtureDirectory !== undefined;
  const fixtureDirectory = options.testFixtureDirectory ?? join(sourceRoot, 'fixtures/normalized', spec.fixtures.pair);
  const oldPath = resolve(fixtureDirectory, 'old.json'); const newPath = resolve(fixtureDirectory, 'new.json');
  const metaPath = resolve(fixtureDirectory, 'meta.json');
  let payloads: [unknown, unknown]; let meta: Record<string, unknown>;
  try {
    const files = await Promise.all([oldPath, newPath, metaPath].map(path => readFile(path, 'utf8')));
    payloads = [JSON.parse(files[0]!) as unknown, JSON.parse(files[1]!) as unknown];
    meta = asObject(JSON.parse(files[2]!) as unknown, 'fixture metadata');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`BLOCKER: real provider-produced sub-updated-single fixture pair is absent.\nExpected:\n${oldPath}\n${newPath}\n${metaPath}`);
    throw error;
  }
  if (synthetic && meta.synthetic !== true) throw new Error('Internal test fixtures must explicitly declare meta.synthetic: true');
  if (!synthetic && meta.synthetic === true) throw new Error('Synthetic fixtures are forbidden in product fixture directories');
  const oldVersion = fixtureVersion(payloads[0], 'old fixture'); const newVersion = fixtureVersion(payloads[1], 'new fixture');
  if (oldVersion === newVersion) throw new Error('Fixture envelopes need distinct API-version labels to preserve both execution artifacts');
  const fixture: FixturePair = { id: synthetic ? `synthetic-${spec.fixtures.pair}` : spec.fixtures.pair, role: 'planning', oldPath, newPath, oldVersion, newVersion };
  const paths = artifactPaths(options.artifactProjectRoot ?? projectRoot);
  const ref = (path: string) => relative(paths.root, path);
  // Clear only this invocation's known outputs so a failed re-run cannot leave stale evidence.
  for (const target of [paths.diffReport, paths.verdict, paths.report,
    ...[fixture.oldVersion, fixture.newVersion].flatMap(payloadVersion => [0, 1].map(runIndex => paths.signature({ entryPointId: entryPoint.id, codeVersion: 'original', fixturePair: fixture.id, payloadVersion, runIndex })))]) {
    await removeJsonArtifact(paths.root, target);
  }
  // Only executed artifacts are created: no empty reasoning or repair directories.
  await writeJsonArtifact(paths.root, paths.selectedSpecs, 'SelectedSpecs', selected);
  await writeJsonArtifact(paths.root, paths.bdg, 'BDG', bdg);
  const log = ['Isotope verify', `ChangeSpec: ${spec.id}`, `Entry point: ${join(projectRoot, entryPoint.file)}#${entryPoint.export}`,
    'Scope: explicit Phase 2 entry point', 'BDG: static walking-skeleton artifact', 'AST resolver: not implemented in this phase',
    synthetic ? 'Fixtures: SYNTHETIC TEST-ONLY — not Stripe-produced; not product acceptance' : 'Fixtures: supplied provider fixture pair',
    `Fixture pair: ${fixture.id}`, `Old: ${oldVersion}`, `New: ${newVersion}`, 'Semantic reasoner: not invoked', 'Repair: not invoked'];
  let signatures: HarnessResult | null = null;
  let diff: DiffReport | null = null;
  let result: VerdictResult;
  const signatureRefs: string[] = [];
  try {
    const execution = { repoRoot: projectRoot, config, entryPoint, fixture, codeVersion: 'original' as const };
    signatures = {
      old: [await runTsHarness(createTsHarnessPlan(execution, 'old', 0)), await runTsHarness(createTsHarnessPlan(execution, 'old', 1))],
      new: [await runTsHarness(createTsHarnessPlan(execution, 'new', 0)), await runTsHarness(createTsHarnessPlan(execution, 'new', 1))],
    };
    for (const signature of [...signatures.old, ...signatures.new]) {
      const path = paths.signature(signature);
      await writeJsonArtifact(paths.root, path, 'Signature', signature);
      signatureRefs.push(ref(path));
    }
    diff = diffSignatures({ old: signatures.old[0], new: signatures.new[0], bdg, selfComparisons: signatures });
    await writeJsonArtifact(paths.root, paths.diffReport, 'DiffReport', diff);
    result = resolveVerdict({ entryPoint, bdg, diff, reasoning: null, config });
    log.push(`Determinism: old ${checkDeterminism(signatures.old).stable ? 'PASS' : 'UNSTABLE'}; new ${checkDeterminism(signatures.new).stable ? 'PASS' : 'UNSTABLE'}`);
    if (signatures.old[0].threw === null && signatures.new[0].threw === null && isHttp200(signatures.old[0].returned) && isHttp200(signatures.new[0].returned)) log.push('Both executions returned 200.');
    for (const divergence of diff.divergences) {
      const display = (value: unknown) => value === '__undefined__' ? 'undefined' : JSON.stringify(value);
      log.push(`${divergence.sinkKind ?? 'handler'} ${divergence.pointer}`, `  old: ${display(divergence.old)}`, `  new: ${display(divergence.new)}`, `  ${divergence.kind} / ${divergence.tier === 'semantic_question' ? 'semantic question' : `mechanical / ${divergence.severity ?? 'unstable'}`}`);
    }
    if (result.verdict === 'ESCALATE') log.push('Semantic reasoner: unavailable in current build; decision required.');
  } catch (error) {
    if (!(error instanceof HarnessExecutionError)) throw error;
    result = validateContract('VerdictResult', { entryPointId: entryPoint.id, verdict: 'INDETERMINATE', provenance: 'mechanical', reason: error.reason,
      divergenceIds: [], reasoningRefs: [], evidenceRefs: [], suspectedInjection: false });
    log.push(`Harness could not produce trustworthy behavior: ${error.message}`);
  }
  const verdict = validateContract('VerdictReport', { schemaVersion: 1, verdict: result.verdict, results: [result] });
  await writeJsonArtifact(paths.root, paths.verdict, 'VerdictReport', verdict);
  const report = validateContract('IsotopeReport', { schemaVersion: 1, selectedSpecs: selected, bdgRef: ref(paths.bdg), signatureRefs,
    diffReportRefs: diff ? [ref(paths.diffReport)] : [], evidencePacketRefs: [], reasoningRefs: [], verdict,
    repairPacketRefs: [], candidateRefs: [], repairVerifications: [], verifiedRepairs: [], audit: [] });
  await writeJsonArtifact(paths.root, paths.report, 'IsotopeReport', report);
  // Read the final artifact through the same public boundary used by later stages.
  await readJsonArtifact(paths.root, paths.report, 'IsotopeReport');
  log.push(`Verdict: ${result.verdict}`, `Reason: ${result.reason}`, `Artifacts: ${paths.root}`);
  const exitCode = result.verdict === 'PASS' ? 0 : result.verdict === 'FAIL' ? 1 : result.verdict === 'ESCALATE' ? 3 : 4;
  return { exitCode, output: log.join('\n'), report, signatures, diff };
}
