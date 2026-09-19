import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { verifyWalkingSkeleton } from './walking-skeleton';

interface AccuracyCase {
  id: string;
  status?: 'run' | 'blocked';
  reason?: string;
  repository?: string;
  config?: string;
  fixturePair?: string;
  expectedVerdict?: string;
}

export async function runAccuracy(): Promise<{ output: string; exitCode: number }> {
  const root = resolve(__dirname, '../../..');
  const path = join(root, 'corpus/accuracy/cases.json');
  let cases: AccuracyCase[] = [];
  try { cases = JSON.parse(await readFile(path, 'utf8')) as AccuracyCase[]; } catch { cases = []; }
  const results: { id: string; status: string; expected?: string; actual?: string; matched?: boolean; reason?: string }[] = [];
  for (const item of cases) {
    if (item.status === 'blocked' || !item.repository) {
      results.push({ id: item.id, status: 'blocked', reason: item.reason ?? 'historical repository is not present in this checkout' });
      continue;
    }
    const run = await verifyWalkingSkeleton({
      configPath: resolve(root, item.repository, item.config ?? 'isotope.yml'),
      disableReasoner: true, disableRepair: true,
      ...(item.fixturePair ? { testFixtureDirectory: resolve(root, item.fixturePair) } : {}),
    });
    const actual = run.report.verdict.verdict;
    results.push({ id: item.id, status: 'run', ...(item.expectedVerdict ? { expected: item.expectedVerdict } : {}), actual, ...(item.expectedVerdict ? { matched: actual === item.expectedVerdict } : {}) });
  }
  const run = results.filter(r => r.status === 'run');
  const matched = run.filter(r => r.matched).length;
  const blocked = results.filter(r => r.status === 'blocked').length;
  const lines = [
    'Isotope accuracy (detection vs labeled local stand-ins)',
    `N_run = ${run.length}`,
    `N_blocked_historical = ${blocked}`,
    `N_matched = ${matched}`,
    `precision_among_run = ${run.length ? `${matched}/${run.length}` : 'undefined (N_run=0)'}`,
    'Remote historical forks named in v3 are recorded as blocked unless their commits exist locally. No commit IDs were inferred from repository names.',
  ];
  for (const r of results) lines.push(`  ${r.id}: ${r.status}${r.actual ? ` actual=${r.actual}` : ''}${r.reason ? ` (${r.reason})` : ''}`);
  const outDir = join(root, '.isotope/accuracy');
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'results.json'), JSON.stringify({ schemaVersion: 1, results, nRun: run.length, nBlocked: blocked, nMatched: matched }, null, 2) + '\n');
  lines.push(`Artifacts: ${outDir}`);
  return { output: lines.join('\n'), exitCode: 0 };
}
