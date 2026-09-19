import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { validateContract, type FleetInput, type FleetResult, type IsotopeReport, type Verdict } from '@isotope/core';

export interface DashboardInput {
  reports: { id: string; path: string; report: IsotopeReport }[];
  outPath: string;
  reasoner: boolean;
  repair: boolean;
}

function counts(reports: IsotopeReport[]): Record<string, number> {
  const out: Record<string, number> = { PASS: 0, PASS_REASONED: 0, FAIL: 0, FAIL_REASONED: 0, ESCALATE: 0, INDETERMINATE: 0, SKIP: 0 };
  for (const report of reports) out[report.verdict.verdict] = (out[report.verdict.verdict] ?? 0) + 1;
  return out;
}

/** Self-contained HTML dashboard. Inline CSS/JS only; opens over file://. */
export async function renderDashboard(input: DashboardInput): Promise<string> {
  const summary = counts(input.reports.map(r => r.report));
  const verified = input.reports.reduce((n, r) => n + r.report.verifiedRepairs.length, 0);
  const repairable = input.reports.filter(r => r.report.verdict.verdict === 'FAIL' || r.report.verdict.verdict === 'FAIL_REASONED').length;
  const rows = input.reports.map(item => {
    const site = item.report.selectedSpecs.specs[0]?.id ?? '';
    const result = item.report.verdict.results[0];
    return { id: item.id, path: item.path, verdict: item.report.verdict.verdict as Verdict, reason: result?.reason ?? '', entry: result?.entryPointId ?? '', spec: site, verified: item.report.verifiedRepairs.length };
  });
  const data = { generatedAt: 'static', reasoner: input.reasoner, repair: input.repair, total: input.reports.length, summary, repairable, verified, rows,
    framing: 'this is what the provider would see before shipping the version.' };
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Isotope fleet</title>
<style>
body{font-family:ui-sans-serif,system-ui,sans-serif;margin:24px;color:#111;background:#fff}
h1{font-size:1.4rem} table{border-collapse:collapse;width:100%;margin-top:16px}
th,td{border:1px solid #ccc;padding:8px;text-align:left;font-size:14px}
.FAIL,.FAIL_REASONED{color:#9b1c1c}.PASS,.PASS_REASONED{color:#166534}.ESCALATE{color:#9a3412}
.counts span{display:inline-block;margin-right:12px}
</style></head><body>
<h1>Isotope fleet</h1>
<p>${data.framing}</p>
<p class="counts">Scanned: ${data.total}. Repairable: ${data.repairable}. Verified repairs: ${data.verified}. Reasoner: ${data.reasoner ? 'on' : 'off'}. Repair: ${data.repair ? 'on' : 'off'}.</p>
<p>${Object.entries(summary).map(([k,v]) => `${k}: ${v}`).join(' · ')}</p>
<table><thead><tr><th>Repository</th><th>Verdict</th><th>ChangeSpec</th><th>Reason</th><th>Verified repairs</th></tr></thead>
<tbody>${rows.map(r => `<tr><td>${r.id}</td><td class="${r.verdict}">${r.verdict}</td><td>${r.spec}</td><td>${r.reason}</td><td>${r.verified}</td></tr>`).join('')}</tbody></table>
<script type="application/json" id="fleet-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
</body></html>
`;
  await mkdir(dirname(input.outPath), { recursive: true });
  await writeFile(input.outPath, html);
  return input.outPath;
}

export async function runFleet(input: FleetInput): Promise<FleetResult> {
  validateContract('SelectedSpecs', input.selectedSpecs);
  const dashboardPath = await renderDashboard({ reports: [], outPath: input.outPath, reasoner: false, repair: false });
  return { reports: [], dashboardPath };
}
