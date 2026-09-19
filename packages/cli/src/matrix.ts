import { listProviders } from '@isotope/providers';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { artifactPaths, readJsonArtifact, type BDG, type DiffReport, type IsotopeReport, type Verdict } from '@isotope/core';
import { checkDeterminism } from '@isotope/differ';
import { selectChangeSpecs } from '@isotope/changespec';
import { verifyWalkingSkeleton } from './walking-skeleton';

const execute = promisify(execFile);

export interface DetectionCase {
  id: string;
  description: string;
  repositoryRoot: string;
  baseRef: string;
  headRef: string;
  configPath: string;
  fixturePair: string | null;
  ecosystem?: 'npm' | 'pypi';
  dependency?: { package: string; from: string; to: string };
  reasoner?: boolean;
  repair?: boolean;
  planner?: 'model' | 'deterministic-only';
  reasonerCassettes?: string[];
  plannerCassette?: string;
  assumeCredentials?: boolean;
  expected: {
    selectedSpecIds: string[];
    affectedSiteCount: number;
    minimumAuthoritativeSites?: number;
    reachableSinkKinds?: string[];
    verdict: Verdict;
    exitCode: number;
    divergenceKinds?: string[];
    verdictReason?: string;
    ambiguityCandidate?: boolean;
    reachesL3: boolean;
    verifiedRepair?: boolean;
    reasoning?: boolean;
    executionsCompletedNormally?: boolean;
  };
  tags?: string[];
}

export interface MatrixOptions { caseId?: string; keepArtifacts?: boolean; allowBlocked?: boolean; group?: string; provider?: string; }
interface CaseResult {
  id: string; description: string; expectedVerdict: Verdict; actualVerdict: Verdict | null;
  expectedExitCode: number; actualExitCode: number | null; acceptance: 'matched' | 'mismatch' | 'blocked';
  selectedSpecIds: string[]; affectedSiteCount: number | null; authoritativeSiteCount: number | null;
  confidence: string[]; reachableSinkKinds: string[]; divergenceKinds: string[]; fixturePair: string | null;
  repositoryKind: 'internal-controlled'; baseRef: string; headRef: string; configPath: string;
  verdictReason: string | null; oldStable: boolean | null; newStable: boolean | null; executionsCompletedNormally: boolean | null;
  ambiguityCandidate: boolean;
  artifactRoot: string; blocker?: string; workspace?: string;
}

function sourceRoot(): string { return resolve(__dirname, '../../..'); }
function dependencyForCase(caseDef: DetectionCase, ecosystem: 'npm' | 'pypi'): { package: string; from: string; to: string } {
  if (caseDef.dependency) return caseDef.dependency;
  const provider = listProviders().find(item => caseDef.expected.selectedSpecIds.some(id => id === item.id || id.startsWith(`${item.id}.`)));
  const matcher = provider?.dependencyMatchers.find(item => item.ecosystem === ecosystem);
  if (!matcher || !provider?.defaultUpgrade) throw new Error(`Detection case ${caseDef.id} must declare dependency`);
  return { package: matcher.package, from: provider.defaultUpgrade.from, to: provider.defaultUpgrade.to };
}
async function acquireMatrixLock(): Promise<() => Promise<void>> {
  const lock = join(sourceRoot(), '.isotope/matrix.lock'); await mkdir(dirname(lock), { recursive: true });
  for (let attempt = 0; attempt < 1200; attempt++) {
    try { await mkdir(lock); return async () => { await rm(lock, { recursive: true, force: true }); }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; await delay(100); }
  }
  throw new Error(`Timed out waiting for matrix lock: ${lock}`);
}
async function loadCases(): Promise<DetectionCase[]> {
  const path = join(sourceRoot(), 'corpus/cases/detection-cases.json');
  const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
  if (!Array.isArray(value)) throw new Error('detection-cases.json must contain an array');
  return value as DetectionCase[];
}
async function git(cwd: string, ...args: string[]): Promise<void> { await execute('git', args, { cwd }); }
async function materializeCase(caseDef: DetectionCase): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), `isotope-matrix-${caseDef.id}-`)));
  const template = resolve(sourceRoot(), caseDef.repositoryRoot);
  await cp(template, root, { recursive: true });
  await git(root, 'init', '--quiet');
  await git(root, 'config', 'user.email', 'acceptance@isotope.local');
  await git(root, 'config', 'user.name', 'Isotope Acceptance');
  if (caseDef.ecosystem === 'pypi') {
    const dep = caseDef.dependency ?? dependencyForCase(caseDef, 'pypi');
    await writeFile(join(root, 'requirements.txt'), `${dep.package}==${dep.from}\n`);
    await git(root, 'add', '.'); await git(root, 'commit', '--quiet', '-m', 'acceptance base'); await git(root, 'tag', caseDef.baseRef);
    await writeFile(join(root, 'requirements.txt'), `${dep.package}==${dep.to}\n`);
    await git(root, 'add', 'requirements.txt'); await git(root, 'commit', '--quiet', '-m', `upgrade ${dep.package}`); await git(root, 'tag', caseDef.headRef);
  } else {
    const dep = caseDef.dependency ?? dependencyForCase(caseDef, 'npm');
    await writeFile(join(root, 'package.json'), JSON.stringify({ private: true, dependencies: { [dep.package]: dep.from } }, null, 2) + '\n');
    await git(root, 'add', '.'); await git(root, 'commit', '--quiet', '-m', 'acceptance base'); await git(root, 'tag', caseDef.baseRef);
    await writeFile(join(root, 'package.json'), JSON.stringify({ private: true, dependencies: { [dep.package]: dep.to } }, null, 2) + '\n');
    await git(root, 'add', 'package.json'); await git(root, 'commit', '--quiet', '-m', `upgrade ${dep.package}`); await git(root, 'tag', caseDef.headRef);
  }
  try {
    const cfgPath = join(root, caseDef.configPath);
    const cfg = JSON.parse(await readFile(cfgPath, 'utf8')) as { reasoner: { mode: string }; repair: { mode: string; planner: string } };
    if (caseDef.reasoner) cfg.reasoner.mode = 'on';
    if (caseDef.repair) cfg.repair.mode = 'on';
    if (caseDef.planner) cfg.repair.planner = caseDef.planner;
    await writeFile(cfgPath, JSON.stringify(cfg));
  } catch { /* YAML configs are left unchanged */ }
  return root;
}

function cassetteModel(files: string[], kind: 'reasoner' | 'planner') {
  const root = sourceRoot();
  const votes = files.map(name => JSON.parse(require('node:fs').readFileSync(join(root, 'tests/cassettes', kind, `${name}.json`), 'utf8')));
  let i = 0;
  return { modelId: `cassette-${kind}`, classify: async (input: { user: string }) => {
    const raw = votes[Math.min(i, votes.length - 1)];
    i += 1;
    const vote = raw.voteA ?? raw;
    if (typeof vote === 'string') return vote;
    const match = /<evidence>\n([\s\S]*?)<\/evidence>/.exec(input.user);
    if (!match) return JSON.stringify(vote);
    const packet = JSON.parse(match[1]!);
    const next = { ...vote };
    if (packet.diff?.[0]?.pointer) next.evidenceRefs = [{ kind: 'diff', pointer: packet.diff[0].pointer }];
    return JSON.stringify(next);
  } };
}
function sameStrings(actual: string[], expected: string[]): boolean {
  return JSON.stringify([...new Set(actual)].sort()) === JSON.stringify([...new Set(expected)].sort());
}
function authoritative(bdg: BDG): number { return bdg.affectedSites.filter(s => s.provenance.confidence !== 'low').length; }
async function runCase(caseDef: DetectionCase, matrixRoot: string, options: MatrixOptions): Promise<CaseResult> {
  const destination = join(matrixRoot, caseDef.id);
  await rm(destination, { recursive: true, force: true }); await mkdir(destination, { recursive: true });
  let workspace: string | undefined;
  const base: CaseResult = { id: caseDef.id, description: caseDef.description, expectedVerdict: caseDef.expected.verdict,
    actualVerdict: null, expectedExitCode: caseDef.expected.exitCode, actualExitCode: null, acceptance: 'blocked', selectedSpecIds: [],
    affectedSiteCount: null, authoritativeSiteCount: null, confidence: [], reachableSinkKinds: [], divergenceKinds: [],
    fixturePair: caseDef.fixturePair, repositoryKind: 'internal-controlled', baseRef: caseDef.baseRef, headRef: caseDef.headRef,
    configPath: caseDef.configPath, artifactRoot: destination, verdictReason: null, oldStable: null, newStable: null,
    executionsCompletedNormally: null, ambiguityCandidate: false };
  try {
    if (caseDef.fixturePair) {
      const fixture = resolve(sourceRoot(), caseDef.fixturePair);
      await Promise.all(['old.json', 'new.json', 'meta.json'].map(name => readFile(join(fixture, name), 'utf8')));
    }
    workspace = await materializeCase(caseDef);
    const selection = await selectChangeSpecs({ repositoryRoot: workspace, baseRef: caseDef.baseRef, headRef: caseDef.headRef, specsRoot: join(sourceRoot(), 'specs') });
    base.selectedSpecIds = selection.selected.specs.map(s => s.id);
    const run = await verifyWalkingSkeleton({ configPath: join(workspace, caseDef.configPath), artifactProjectRoot: workspace,
      disableReasoner: caseDef.reasoner !== true, disableRepair: caseDef.repair !== true, selectedSpecs: selection.selected,
      ...(caseDef.fixturePair ? { testFixtureDirectory: resolve(sourceRoot(), caseDef.fixturePair) } : {}),
      ...(caseDef.reasonerCassettes ? { semanticModel: cassetteModel(caseDef.reasonerCassettes, 'reasoner') } : {}),
      ...(caseDef.plannerCassette ? { plannerModel: cassetteModel([caseDef.plannerCassette], 'planner') } : {}),
      ...(caseDef.assumeCredentials !== undefined ? { assumeCredentials: caseDef.assumeCredentials } : {}),
    });
    const generated = artifactPaths(workspace).root;
    await cp(generated, destination, { recursive: true, force: true });
    const report = await readJsonArtifact(destination, join(destination, 'isotope-report.json'), 'IsotopeReport') as IsotopeReport;
    const bdg = await readJsonArtifact(destination, join(destination, 'bdg.json'), 'BDG') as BDG;
    const diffs: DiffReport[] = [];
    for (const ref of report.diffReportRefs) diffs.push(await readJsonArtifact(destination, join(destination, ref), 'DiffReport') as DiffReport);
    base.actualVerdict = report.verdict.verdict; base.actualExitCode = run.exitCode;
    base.verdictReason = report.verdict.results[0]?.reason ?? null;
    base.affectedSiteCount = bdg.affectedSites.length; base.authoritativeSiteCount = authoritative(bdg);
    base.confidence = [...new Set(bdg.affectedSites.map(s => s.provenance.confidence))].sort();
    base.reachableSinkKinds = [...new Set(bdg.sinks.map(s => s.kind))].sort();
    base.divergenceKinds = diffs.flatMap(d => d.divergences.map(x => x.kind));
    base.ambiguityCandidate = diffs.some(d => d.divergences.some(x => x.ambiguityCandidate === true));
    const reachedL3 = report.signatureRefs.length > 0;
    if (run.signatures) {
      base.oldStable = checkDeterminism(run.signatures.old).stable; base.newStable = checkDeterminism(run.signatures.new).stable;
      base.executionsCompletedNormally = [...run.signatures.old, ...run.signatures.new].every(x => x.threw === null);
    }
    const noReasoner = report.reasoningRefs.length === 0 && report.evidencePacketRefs.length === 0;
    const exp = caseDef.expected;
    const expectNormal = exp.executionsCompletedNormally !== false;
    const matched = sameStrings(base.selectedSpecIds, exp.selectedSpecIds) && base.actualVerdict === exp.verdict && base.actualExitCode === exp.exitCode
      && base.affectedSiteCount === exp.affectedSiteCount && (exp.minimumAuthoritativeSites === undefined || base.authoritativeSiteCount >= exp.minimumAuthoritativeSites)
      && (exp.reachableSinkKinds === undefined || exp.reachableSinkKinds.every(x => base.reachableSinkKinds.includes(x)))
      && (exp.divergenceKinds === undefined || exp.divergenceKinds.every(x => base.divergenceKinds.includes(x)))
      && (exp.verdictReason === undefined || base.verdictReason === exp.verdictReason)
      && (exp.ambiguityCandidate === undefined || base.ambiguityCandidate === exp.ambiguityCandidate)
      && reachedL3 === exp.reachesL3 && (!reachedL3 || exp.verdict === 'INDETERMINATE' || (base.oldStable === true && base.newStable === true && base.executionsCompletedNormally === expectNormal))
      && (reachedL3 || (report.signatureRefs.length === 0 && report.diffReportRefs.length === 0))
      && (exp.reasoning === true ? report.reasoningRefs.length > 0 : noReasoner)
      && (exp.verifiedRepair === undefined || (report.verifiedRepairs.length > 0) === exp.verifiedRepair);
    base.acceptance = matched ? 'matched' : 'mismatch';
    if (options.keepArtifacts) base.workspace = workspace;
    return base;
  } catch (error) {
    base.blocker = error instanceof Error ? error.message : String(error);
    if (workspace && options.keepArtifacts) base.workspace = workspace;
    return base;
  } finally {
    if (workspace && !options.keepArtifacts) await rm(workspace, { recursive: true, force: true });
  }
}

export async function runDetectionMatrix(options: MatrixOptions = {}): Promise<{ exitCode: number; output: string; results: CaseResult[] }> {
  const release = await acquireMatrixLock();
  try {
    const all = await loadCases();
    const group = options.group ?? 'detection';
    const selected = options.caseId ? all.filter(c => c.id === options.caseId)
      : options.provider ? all.filter(c => c.tags?.includes(options.provider!) || c.expected.selectedSpecIds.some(id => id === options.provider || id.startsWith(`${options.provider}.`)))
      : group === 'detection' ? all.filter(c => c.tags?.includes('required') && !c.tags?.includes('acceptance'))
      : all;
    const cases = selected;
    if (!cases.length) throw new Error(`Unknown detection case: ${options.caseId ?? options.provider ?? '(none)'}`);
    const matrixRoot = process.env.ISOTOPE_MATRIX_ROOT ? resolve(process.env.ISOTOPE_MATRIX_ROOT) : join(sourceRoot(), '.isotope/matrix');
    await mkdir(matrixRoot, { recursive: true });
    const results: CaseResult[] = [];
    for (const caseDef of cases) results.push(await runCase(caseDef, matrixRoot, options));
    const summary = { schemaVersion: 1, group, results };
    await writeFile(join(matrixRoot, 'results.json'), JSON.stringify(summary, null, 2) + '\n');
    const width = Math.max(24, ...results.map(r => r.id.length + 2));
    const lines = ['Isotope detection matrix', '', `${'CASE'.padEnd(width)}EXPECTED    ACTUAL      STATUS`];
    for (const r of results) lines.push(`${r.id.padEnd(width)}${r.expectedVerdict.padEnd(12)}${(r.actualVerdict ?? 'UNAVAILABLE').padEnd(12)}${r.acceptance === 'matched' ? '✓' : r.acceptance.toUpperCase()}`);
    const matched = results.filter(r => r.acceptance === 'matched').length;
    lines.push('', `${matched}/${results.length} required cases matched.`, `Artifacts: ${matrixRoot}`);
    for (const r of results.filter(x => x.blocker)) lines.push(`Blocked ${r.id}: ${r.blocker}`);
    const unacceptable = results.some(r => r.acceptance === 'mismatch' || (r.acceptance === 'blocked' && !options.allowBlocked));
    return { exitCode: unacceptable ? 1 : 0, output: lines.join('\n'), results };
  } finally { await release(); }
}
