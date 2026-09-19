import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { verifyRepository } from '@isotope/cli';
import { buildAnnotations, mapVerdictToConclusion, publishGitHubReport, renderCheckSummary } from '@isotope/reporter';
import { loadActionContext } from './context';
import { githubClient } from './github';
import { loadReportEvidence } from './artifacts';

function input(name: string, fallback = ''): string { return (process.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] ?? fallback).trim(); }
async function output(name: string, value: string | number): Promise<void> {
  const path = process.env.GITHUB_OUTPUT; if (path) await appendFile(path, `${name}<<ISOTOPE_EOF\n${value}\nISOTOPE_EOF\n`); else console.log(`::set-output name=${name}::${value}`);
}
function annotationCommand(level: 'error' | 'warning' | 'notice', a: ReturnType<typeof buildAnnotations>[number]): void {
  const esc = (v: string) => v.replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A').replace(/:/g,'%3A').replace(/,/g,'%2C');
  console.log(`::${level} file=${esc(a.path)},line=${a.start_line},endLine=${a.end_line},title=${esc(a.title)}::${esc(a.message)}`);
}
async function prepareHarnessRuntime(): Promise<{ root: string; dispose(): Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'isotope-action-runtime-')); const archive = resolve(__dirname, '../vendor/vitest-runtime.tgz');
  await new Promise<void>((done, reject) => { const child = spawn('tar', ['-xzf', archive, '-C', root], { stdio: ['ignore','ignore','pipe'] }); let stderr=''; child.stderr.on('data', d => { stderr=(stderr+String(d)).slice(-2000); }); child.once('error', reject); child.once('close', code => code === 0 ? done() : reject(new Error(`Cannot unpack Action runtime: ${stderr}`))); });
  return { root, dispose: () => rm(root, { recursive: true, force: true }) };
}
async function main(): Promise<void> {
  const mode = input('mode', 'verify'); const reasoner = input('reasoner', 'off'); const repair = input('repair', 'off');
  if (reasoner !== 'off' && reasoner !== 'on') throw new Error('Reasoner must be on or off');
  if (!['on', 'off'].includes(repair)) throw new Error('Repair must be on or off');
  if (input('fail-on', 'critical,high').replace(/\s/g, '') !== 'critical,high') throw new Error('Phase 8 supports only fail-on=critical,high');
  const context = await loadActionContext({ base: input('base'), head: input('head'), pullNumber: input('pr-number') });
  const repositoryRoot = resolve(process.env.GITHUB_WORKSPACE ?? process.cwd());
  let runtime: Awaited<ReturnType<typeof prepareHarnessRuntime>> | null = null;
  let artifactRoot = resolve(repositoryRoot, input('artifact-root', '.isotope'));
  if (mode === 'verify') {
    runtime = await prepareHarnessRuntime(); process.once('exit', () => rmSync(runtime!.root, { recursive: true, force: true })); process.env.ISOTOPE_ACTION_RUNTIME_ROOT = join(runtime.root, 'runtime');
    const internalFixture = process.env.ISOTOPE_ACTION_TEST_MODE === '1' ? process.env.ISOTOPE_INTERNAL_TEST_FIXTURES : undefined;
    const key = input('gemini-api-key'); if (key) process.env.GEMINI_API_KEY = key;
    const result = await verifyRepository({ repositoryRoot, configPath: input('config', 'isotope.yml'), specsPath: input('specs-path', resolve(__dirname, '../../specs')), fixturesPath: input('fixtures-path', resolve(__dirname, '../../fixtures/normalized')), baseRef: context.baseSha, headRef: context.headSha, reasoner: reasoner as 'on' | 'off', repair: repair as 'on' | 'off',
      ...(internalFixture ? { testFixtureDirectory: internalFixture } : {}) });
    artifactRoot = result.artifactRoot; console.log(result.output);
  } else if (mode !== 'report') throw new Error('mode must be verify or report');
  const evidence = await loadReportEvidence(artifactRoot); const verdict = evidence.report.verdict.verdict;
  await output('verdict', verdict); await output('report-path', join(artifactRoot, 'isotope-report.json'));
  await output('selected-spec-count', evidence.selected.specs.length); await output('affected-site-count', evidence.bdg?.affectedSites.length ?? 0);
  const summaryPath = process.env.GITHUB_STEP_SUMMARY; if (summaryPath) await appendFile(summaryPath, `${renderCheckSummary(evidence)}\n`);
  const token = input('github-token');
  if (token) {
    const published = await publishGitHubReport({ client: githubClient(token), owner: context.owner, repo: context.repo, pullNumber: context.pullNumber, headSha: context.headSha, evidence });
    for (const error of published.errors) console.warn(`Reporter warning: ${error}`);
  }
  for (const a of buildAnnotations(evidence)) annotationCommand(a.annotation_level === 'failure' ? 'error' : a.annotation_level, a);
  const conclusion = mapVerdictToConclusion(verdict);
  if (conclusion === 'failure') { console.error(`Isotope verdict ${verdict} blocks this pull request.`); process.exitCode = 1; }
  else if (conclusion === 'neutral') console.warn('Isotope verdict INDETERMINATE; no incompatibility was inferred.');
  await runtime?.dispose();
}
main().catch(error => { console.error(`::error title=Isotope Action::${String(error).replace(/\r?\n/g, ' ')}`); process.exitCode = 10; });
