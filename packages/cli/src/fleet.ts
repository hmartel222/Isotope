import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { renderDashboard } from '@isotope/fleet';
import { verifyWalkingSkeleton } from './walking-skeleton';

export interface FleetCliOptions {
  repos?: string;
  spec?: string;
  out?: string;
  reason?: boolean;
  repair?: boolean;
  configPath: string;
}

export async function runFleetCommand(options: FleetCliOptions): Promise<{ output: string; exitCode: number }> {
  if (!options.repos || !options.out) throw new Error('--repos and --out are required');
  const manifestPath = resolve(options.repos);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { repositories?: { id: string; path: string; config?: string; fixturePair?: string }[] };
  const repos = manifest.repositories ?? [];
  const reports: { id: string; path: string; report: import('@isotope/core').IsotopeReport }[] = [];
  const lines = ['Isotope fleet', `Reasoner: ${options.reason ? 'on' : 'off'}`, `Repair: ${options.repair ? 'on' : 'off'}`];
  for (const repo of repos) {
    const root = resolve(dirname(manifestPath), repo.path);
    const configPath = resolve(root, repo.config ?? 'isotope.yml');
    const result = await verifyWalkingSkeleton({
      configPath, disableReasoner: !options.reason, disableRepair: !options.repair,
      ...(repo.fixturePair ? { testFixtureDirectory: resolve(dirname(manifestPath), repo.fixturePair) } : {}),
    });
    reports.push({ id: repo.id, path: root, report: result.report });
    lines.push(`${repo.id}: ${result.report.verdict.verdict} (exit ${result.exitCode})`);
  }
  const dashboardPath = await renderDashboard({ reports, outPath: resolve(options.out), reasoner: options.reason === true, repair: options.repair === true });
  lines.push(`Dashboard: ${dashboardPath}`);
  lines.push('this is what the provider would see before shipping the version.');
  return { output: lines.join('\n'), exitCode: 0 };
}
