import { readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { artifactPaths, readJsonArtifact, removeJsonArtifact, writeJsonArtifact, validateContract, resolveVerdict,
  type DiffReport, type EntryPoint, type FixturePair, type HarnessResult, type IsotopeReport, type VerdictResult, type SelectedSpecs } from '@isotope/core';
import { analyzeConfiguredProject, graphSummary } from './scan';
import { createTsHarnessPlan, runTsHarness, HarnessExecutionError } from '@isotope/harness-ts';
import { checkDeterminism, diffSignatures } from '@isotope/differ';

export interface WalkingSkeletonOptions {
  configPath: string;
  artifactProjectRoot?: string;
  disableReasoner?: boolean;
  disableRepair?: boolean;
  /** Internal tests only. Must contain meta.synthetic=true; never falls back implicitly. */
  testFixtureDirectory?: string;
  selectedSpecs?: SelectedSpecs;
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
function ambiguitySatisfied(payload: unknown, expression: string): boolean {
  const match = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.length\s*>\s*(\d+)$/.exec(expression.trim());
  if (!match) return false;
  let value: unknown = asObject(asObject(asObject(payload, 'fixture').data, 'fixture.data').object, 'fixture.data.object');
  for (const part of match[1]!.split('.')) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    value = (value as Record<string, unknown>)[part];
  }
  return Array.isArray(value) && value.length > Number(match[2]);
}

/** Compatibility API name; Phase 5 replaces the static graph with real L2. */
export async function verifyWalkingSkeleton(options: WalkingSkeletonOptions): Promise<WalkingSkeletonResult> {
  const analysis = await analyzeConfiguredProject(options.configPath, options.selectedSpecs);
  const results: WalkingSkeletonResult[] = [];
  for (const entry of analysis.bdg.entryPoints) {
    const artifactProjectRoot = analysis.bdg.entryPoints.length === 1 ? options.artifactProjectRoot
      : join(options.artifactProjectRoot ?? analysis.projectRoot, '.isotope/entries', entry.id);
    results.push(await verifyEntry({ ...options, ...(artifactProjectRoot ? { artifactProjectRoot } : {}) }, analysis, entry));
  }
  if (results.length === 1) return results[0]!;
  const paths = artifactPaths(options.artifactProjectRoot ?? analysis.projectRoot);
  await removeJsonArtifact(paths.root, paths.diffReport);
  const rank = ['SKIP','PASS','PASS_REASONED','INDETERMINATE','ESCALATE','FAIL_REASONED','FAIL'];
  const verdicts = results.flatMap(r => r.report.verdict.results);
  const worst = [...verdicts].sort((a,b) => rank.indexOf(b.verdict) - rank.indexOf(a.verdict))[0]!;
  const verdict = validateContract('VerdictReport', { schemaVersion: 1, verdict: worst.verdict, results: verdicts });
  const refs = (key: 'signatureRefs' | 'diffReportRefs') => results.flatMap((r,i) => r.report[key].map(ref => `entries/${analysis.bdg.entryPoints[i]!.id}/.isotope/${ref}`));
  const report = validateContract('IsotopeReport', { ...results[0]!.report, verdict, bdgRef: 'bdg.json', signatureRefs: refs('signatureRefs'), diffReportRefs: refs('diffReportRefs') });
  await writeJsonArtifact(paths.root, paths.selectedSpecs, 'SelectedSpecs', analysis.selected);
  await writeJsonArtifact(paths.root, paths.bdg, 'BDG', analysis.bdg);
  await writeJsonArtifact(paths.root, paths.verdict, 'VerdictReport', verdict);
  await writeJsonArtifact(paths.root, paths.report, 'IsotopeReport', report);
  return { exitCode: worst.verdict === 'FAIL' ? 1 : worst.verdict === 'ESCALATE' ? 3 : worst.verdict === 'INDETERMINATE' ? 4 : 0, report, signatures: null, diff: null,
    output: [...results.map(r => r.output), `Aggregate verdict: ${worst.verdict}`].join('\n') };
}

async function verifyEntry(options: WalkingSkeletonOptions, analysis: Awaited<ReturnType<typeof analyzeConfiguredProject>>, entryPoint: EntryPoint): Promise<WalkingSkeletonResult> {
  const { projectRoot, config, selected, bdg } = analysis;
  const sourceRoot = resolve(__dirname, '../../..');
  if (options.disableReasoner) config.reasoner.mode = 'off';
  if (options.disableRepair) config.repair.mode = 'off';
  if (config.reasoner.mode !== 'off' || config.repair.mode !== 'off') throw new Error('Phase 5 verify requires reasoner.mode: off and repair.mode: off; neither stage is implemented');
  const spec = selected.specs[0]!;
  const paths = artifactPaths(options.artifactProjectRoot ?? projectRoot);
  const roots = bdg.nodes.filter(n => n.entryPointId === entryPoint.id && n.kind === 'taint_root' && n.provenance.confidence !== 'low');
  if (!roots.length) {
    const incomplete = bdg.skipped.some(d => /^(file_limit|analysis_budget|source_not_found|ignored_or_outside|unsupported_|unresolved_or_ignored|reexport_limit|local_call_limit|invalid_tsconfig|loop_bound)/.test(d.reason));
    const verdict = validateContract('VerdictReport', { schemaVersion: 1, verdict: incomplete ? 'INDETERMINATE' : 'SKIP', results: [{ entryPointId: entryPoint.id, verdict: incomplete ? 'INDETERMINATE' : 'SKIP', provenance: 'mechanical', reason: incomplete ? 'incomplete_static_analysis' : 'no_taint_root', divergenceIds: [], reasoningRefs: [], evidenceRefs: [], suspectedInjection: false }] });
    const report = validateContract('IsotopeReport', { schemaVersion: 1, selectedSpecs: selected, bdgRef: 'bdg.json', signatureRefs: [], diffReportRefs: [], evidencePacketRefs: [], reasoningRefs: [], verdict, repairPacketRefs: [], candidateRefs: [], repairVerifications: [], verifiedRepairs: [], audit: [] });
    await removeJsonArtifact(paths.root, paths.diffReport);
    await writeJsonArtifact(paths.root, paths.selectedSpecs, 'SelectedSpecs', selected);
    await writeJsonArtifact(paths.root, paths.bdg, 'BDG', bdg);
    await writeJsonArtifact(paths.root, paths.verdict, 'VerdictReport', verdict);
    await writeJsonArtifact(paths.root, paths.report, 'IsotopeReport', report);
    return { exitCode: incomplete ? 4 : 0, report, signatures: null, diff: null, output: [`ChangeSpec: ${spec.id}`, ...graphSummary(bdg), `Verdict: ${verdict.verdict}`, `Reason: ${verdict.results[0]!.reason}`, `Artifacts: ${paths.root}`].join('\n') };
  }
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
    'Scope: explicit configured entry point', ...graphSummary(bdg),
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
    const ambiguityChanges = spec.changes.filter((change, index) => change.ambiguity
      && bdg.affectedSites.some(site => site.entryPointId === entryPoint.id && site.changeIndex === index)
      && ambiguitySatisfied(payloads[1], change.ambiguity.when));
    const aggregationSinks = new Set(bdg.sinks.filter(sink => bdg.nodes.some(node => node.id === sink.nodeId && node.entryPointId === entryPoint.id && node.aggregation === true)).map(sink => sink.name));
    const affectedPointers = ambiguityChanges.length ? signatures.old[0].calls
      .map((call, index) => aggregationSinks.has(call.mock) ? `/calls/${index}/args` : null).filter((value): value is string => value !== null) : [];
    diff = diffSignatures({ old: signatures.old[0], new: signatures.new[0], bdg, selfComparisons: signatures,
      ...(affectedPointers.length ? { changeContext: { ambiguitySatisfied: true, affectedPointers } } : {}) });
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
