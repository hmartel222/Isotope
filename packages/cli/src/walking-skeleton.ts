import { join, relative, resolve } from 'node:path';
import { artifactPaths, needsSemanticReasoning, readJsonArtifact, removeJsonArtifact, resolveAggregateVerdict, resolveVerdict, writeJsonArtifact, validateContract,
  type DiffReport, type EntryPoint, type FixturePair, type HarnessResult, type IsotopeReport, type JsonValue, type VerdictResult, type SelectedSpecs } from '@isotope/core';
import { analyzeConfiguredProject, graphSummary } from './scan';
import { createTsHarnessPlan, runTsHarness, HarnessExecutionError } from '@isotope/harness-ts';
import { runHarness as runPyHarness, HarnessExecutionError as PyHarnessExecutionError } from '@isotope/harness-py';
import { checkDeterminism, diffSignatures } from '@isotope/differ';
import { attemptRepair } from './repair-flow';
import { credentialsAvailable, reasonAboutEntryPoint, type SemanticModel } from '@isotope/reasoner';
import { loadFixturePair } from './fixtures';

export interface WalkingSkeletonOptions {
  configPath: string;
  artifactProjectRoot?: string;
  disableReasoner?: boolean;
  disableRepair?: boolean;
  /** Internal tests only. Must contain meta.synthetic=true; never falls back implicitly. */
  testFixtureDirectory?: string;
  /** Product fixture registry. Defaults to this monorepo's fixtures for compatibility. */
  fixtureRoot?: string;
  selectedSpecs?: SelectedSpecs;
  semanticModel?: SemanticModel;
  plannerModel?: SemanticModel;
  assumeCredentials?: boolean;
}
export interface WalkingSkeletonResult {
  exitCode: 0 | 1 | 3 | 4 | 5; output: string; report: IsotopeReport;
  signatures: HarnessResult | null; diff: DiffReport | null;
}
function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function isHttp200(value: unknown): boolean { return value !== null && typeof value === 'object' && 'status' in value && value.status === 200; }
function ambiguitySatisfied(payload: unknown, expression: string): boolean {
  const match = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.length\s*>\s*(\d+)$/.exec(expression.trim());
  if (!match) return false;
  const parts = match[1]!.split('.');
  const locate = (value: unknown, depth = 0): unknown => {
    if (depth > 20 || !value || typeof value !== 'object') return undefined;
    let current: unknown = value;
    for (const part of parts) {
      if (!current || typeof current !== 'object' || Array.isArray(current) || !(part in current)) { current = undefined; break; }
      current = (current as Record<string, unknown>)[part];
    }
    if (current !== undefined) return current;
    for (const child of Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)) {
      const found = locate(child, depth + 1); if (found !== undefined) return found;
    }
    return undefined;
  };
  const value = locate(payload);
  return Array.isArray(value) && value.length > Number(match[2]);
}

/** Compatibility API name; Phase 5 replaces the static graph with real L2. */
export async function verifyWalkingSkeleton(options: WalkingSkeletonOptions): Promise<WalkingSkeletonResult> {
  const analysis = await analyzeConfiguredProject(options.configPath, options.selectedSpecs);
  if (options.disableReasoner) analysis.config.reasoner.mode = 'off';
  if (options.disableRepair) analysis.config.repair.mode = 'off';
  const budget = { remaining: analysis.config.reasoner.maxInvocations };
  const results: WalkingSkeletonResult[] = [];
  for (const entry of analysis.bdg.entryPoints) {
    const artifactProjectRoot = analysis.bdg.entryPoints.length === 1 ? options.artifactProjectRoot
      : join(options.artifactProjectRoot ?? analysis.projectRoot, '.isotope/entries', entry.id);
    results.push(await verifyEntry({ ...options, ...(artifactProjectRoot ? { artifactProjectRoot } : {}) }, analysis, entry, budget));
  }
  if (results.length === 1) return results[0]!;
  const paths = artifactPaths(options.artifactProjectRoot ?? analysis.projectRoot);
  await removeJsonArtifact(paths.root, paths.diffReport);
  const verdict = resolveAggregateVerdict(results.flatMap(r => r.report.verdict.results));
  const refs = (key: 'signatureRefs' | 'diffReportRefs' | 'evidencePacketRefs' | 'reasoningRefs') => results.flatMap((r,i) => r.report[key].map(ref => `entries/${analysis.bdg.entryPoints[i]!.id}/.isotope/${ref}`));
  const report = validateContract('IsotopeReport', { ...results[0]!.report, verdict, bdgRef: 'bdg.json', signatureRefs: refs('signatureRefs'), diffReportRefs: refs('diffReportRefs'), evidencePacketRefs: refs('evidencePacketRefs'), reasoningRefs: refs('reasoningRefs') });
  await writeJsonArtifact(paths.root, paths.selectedSpecs, 'SelectedSpecs', analysis.selected);
  await writeJsonArtifact(paths.root, paths.bdg, 'BDG', analysis.bdg);
  await writeJsonArtifact(paths.root, paths.verdict, 'VerdictReport', verdict);
  await writeJsonArtifact(paths.root, paths.report, 'IsotopeReport', report);
  const exitFor = (value: typeof verdict.verdict) => value === 'FAIL' || value === 'FAIL_REASONED' ? 1 : value === 'ESCALATE' ? 3 : value === 'INDETERMINATE' ? 4 : 0;
  return { exitCode: exitFor(verdict.verdict), report, signatures: null, diff: null,
    output: [...results.map(r => r.output), `Aggregate verdict: ${verdict.verdict}`].join('\n') };
}

async function verifyEntry(options: WalkingSkeletonOptions, analysis: Awaited<ReturnType<typeof analyzeConfiguredProject>>, entryPoint: EntryPoint, budget: { remaining: number }): Promise<WalkingSkeletonResult> {
  const { projectRoot, config, selected, bdg } = analysis;
  const sourceRoot = resolve(__dirname, '../../..');
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
  const fixtureDirectory = options.testFixtureDirectory ?? join(options.fixtureRoot ?? join(sourceRoot, 'fixtures/normalized'), spec.fixtures.pair);
  const loaded = await loadFixturePair({ directory: fixtureDirectory, spec, pairId: spec.fixtures.pair, role: 'planning', synthetic });
  const { fixture, payloads } = loaded;
  const { oldVersion, newVersion } = fixture;
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
    synthetic ? 'Fixtures: SYNTHETIC TEST-ONLY — not provider-produced; not product acceptance' : 'Fixtures: supplied provider fixture pair',
    `Fixture pair: ${fixture.id}`, `Old: ${oldVersion}`, `New: ${newVersion}`, `Semantic reasoner: ${config.reasoner.mode}`];
  let signatures: HarnessResult | null = null;
  let diff: DiffReport | null = null;
  let reasoning = null as import('@isotope/core').ReasoningRun | null;
  let result: VerdictResult;
  const signatureRefs: string[] = [];
  const evidencePacketRefs: string[] = []; const reasoningRefs: string[] = []; const audit: import('@isotope/core').IsotopeReport['audit'] = [];
  try {
    const execution = { repoRoot: projectRoot, config, entryPoint, fixture, codeVersion: 'original' as const };
    signatures = entryPoint.language === 'py'
      ? await runPyHarness({ ...execution, bdg })
      : {
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
    if (needsSemanticReasoning(diff) && config.reasoner.mode === 'on') {
      const semantic = await reasonAboutEntryPoint({
        repoRoot: projectRoot, artifactRoot: options.artifactProjectRoot ?? projectRoot, spec, bdg, entryPoint, diff,
        old: signatures.old[0], new: signatures.new[0], oldPayload: payloads[0] as JsonValue, newPayload: payloads[1] as JsonValue,
        config, remainingInvocations: budget.remaining, ...(options.semanticModel ? { model: options.semanticModel } : {}),
        credentials: options.assumeCredentials ?? (options.semanticModel ? true : credentialsAvailable()),
      });
      budget.remaining -= semantic.invocationsUsed;
      reasoning = semantic.run;
      if (semantic.run.packetRef) evidencePacketRefs.push(semantic.run.packetRef);
      reasoningRefs.push(...semantic.run.responseRefs);
      if (semantic.run.packetHash) for (const [index, responseRef] of semantic.run.responseRefs.entries()) {
        audit.push({ stage: 'reasoner', packetRef: semantic.run.packetRef, packetHash: semantic.run.packetHash, responseRef, invocationIndex: index });
      }
      log.push(`Semantic reasoner: ${semantic.run.status}${semantic.run.cacheHit ? ' (cache)' : ''}${semantic.run.error ? ` (${semantic.run.error})` : ''}`);
    } else if (needsSemanticReasoning(diff)) log.push('Semantic reasoner: disabled; decision required.');
    result = resolveVerdict({ entryPoint, bdg, diff, reasoning, config });
    log.push(`Determinism: old ${checkDeterminism(signatures.old).stable ? 'PASS' : 'UNSTABLE'}; new ${checkDeterminism(signatures.new).stable ? 'PASS' : 'UNSTABLE'}`);
    if (signatures.old[0].threw === null && signatures.new[0].threw === null && isHttp200(signatures.old[0].returned) && isHttp200(signatures.new[0].returned)) log.push('Both executions returned 200.');
    for (const divergence of diff.divergences) {
      const display = (value: unknown) => value === '__undefined__' ? 'undefined' : JSON.stringify(value);
      log.push(`${divergence.sinkKind ?? 'handler'} ${divergence.pointer}`, `  old: ${display(divergence.old)}`, `  new: ${display(divergence.new)}`, `  ${divergence.kind} / ${divergence.tier === 'semantic_question' ? 'semantic question' : `mechanical / ${divergence.severity ?? 'unstable'}`}`);
    }
    if (result.verdict === 'ESCALATE' && !reasoningRefs.length) log.push('Semantic residual requires a human decision or an enabled reasoner.');
  } catch (error) {
    if (!(error instanceof HarnessExecutionError) && !(error instanceof PyHarnessExecutionError)) throw error;
    result = validateContract('VerdictResult', { entryPointId: entryPoint.id, verdict: 'INDETERMINATE', provenance: 'mechanical', reason: error.reason,
      divergenceIds: [], reasoningRefs: [], evidenceRefs: [], suspectedInjection: false });
    log.push(`Harness could not produce trustworthy behavior: ${error.message}`);
    if (typeof error.diagnostics.stderr === 'string' && error.diagnostics.stderr) log.push(`Harness diagnostic: ${error.diagnostics.stderr.slice(-2000).replace(/[\r\n]+/g, ' ')}`);
  }
  const verdict = validateContract('VerdictReport', { schemaVersion: 1, verdict: result.verdict, results: [result] });
  await writeJsonArtifact(paths.root, paths.verdict, 'VerdictReport', verdict);
  let report = validateContract('IsotopeReport', { schemaVersion: 1, selectedSpecs: selected, bdgRef: ref(paths.bdg), signatureRefs,
    diffReportRefs: diff ? [ref(paths.diffReport)] : [], evidencePacketRefs, reasoningRefs, verdict,
    repairPacketRefs: [], candidateRefs: [], repairVerifications: [], verifiedRepairs: [], audit });
  await writeJsonArtifact(paths.root, paths.report, 'IsotopeReport', report);
  // Read the final artifact through the same public boundary used by later stages.
  await readJsonArtifact(paths.root, paths.report, 'IsotopeReport');
  log.push(`Verdict: ${result.verdict}`, `Reason: ${result.reason}`);
  let verified = false;
  if ((result.verdict === 'FAIL' || result.verdict === 'FAIL_REASONED') && config.repair.mode === 'on' && signatures && diff) {
    const repair = await attemptRepair({ projectRoot, artifactProjectRoot: options.artifactProjectRoot ?? projectRoot,
      config, selected, bdg, entryPoint, originalVerdict: result,
      planning: { fixture, original: signatures, oldPayload: payloads[0] as import('@isotope/core').JsonValue, newPayload: payloads[1] as import('@isotope/core').JsonValue },
      fixtureRoot: options.fixtureRoot ?? join(sourceRoot, 'fixtures/normalized'),
      diff, ...(reasoning?.results.length ? { reasoning: reasoning.results } : {}),
      ...(options.plannerModel ? { plannerModel: options.plannerModel } : {}),
      credentialsAvailable: options.assumeCredentials ?? (Boolean(options.plannerModel) || credentialsAvailable()),
      ...(options.testFixtureDirectory ? { testFixtureDirectory: options.testFixtureDirectory } : {}) });
    log.push(...repair.output); verified = repair.verifiedRepair !== null;
    if (repair.packetRef) audit.push({ stage: 'planner', packetRef: repair.packetRef, packetHash: repair.packetHash ?? repair.packetRef, responseRef: repair.candidateRef ?? repair.packetRef, invocationIndex: 0 });
    report = validateContract('IsotopeReport', { ...report,
      repairPacketRefs: repair.packetRef ? [repair.packetRef] : [],
      candidateRefs: repair.candidateRef ? [repair.candidateRef] : [],
      repairVerifications: repair.verification ? [repair.verification] : [],
      verifiedRepairs: repair.verifiedRepair ? [repair.verifiedRepair] : [], audit });
    await writeJsonArtifact(paths.root, paths.report, 'IsotopeReport', report);
  } else log.push(`Repair: ${config.repair.mode === 'off' ? 'disabled' : 'not eligible for this verdict'}`);
  log.push(`Artifacts: ${paths.root}`);
  const exitCode = verified ? 5 : result.verdict === 'PASS' || result.verdict === 'PASS_REASONED' ? 0
    : result.verdict === 'FAIL' || result.verdict === 'FAIL_REASONED' ? 1 : result.verdict === 'ESCALATE' ? 3 : 4;
  return { exitCode, output: log.join('\n'), report, signatures, diff };
}
