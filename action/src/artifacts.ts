import { lstat, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readJsonArtifact, type BDG, type DiffReport, type IsotopeReport, type ReasoningResult, type SelectedSpecs, type Signature } from '@isotope/core';
import type { ReportEvidence } from '@isotope/reporter';

const MAX_TOTAL = 16 * 1024 * 1024;
export async function validateArtifactTree(rootInput: string): Promise<void> {
  const root = resolve(rootInput); let total = 0;
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name); const stat = await lstat(path);
      if (stat.isSymbolicLink()) throw new Error(`Artifact tree contains a symlink: ${entry.name}`);
      if (stat.isDirectory()) await walk(path);
      else if (stat.isFile()) { total += stat.size; if (total > MAX_TOTAL) throw new Error('Artifact tree exceeds 16 MiB'); }
      else throw new Error('Artifact tree contains an unsupported filesystem entry');
    }
  }
  await walk(root);
}
export async function loadReportEvidence(rootInput: string): Promise<ReportEvidence> {
  const root = resolve(rootInput); await validateArtifactTree(root);
  const report = await readJsonArtifact(root, join(root, 'isotope-report.json'), 'IsotopeReport') as IsotopeReport;
  const selected = await readJsonArtifact(root, join(root, 'selected-specs.json'), 'SelectedSpecs') as SelectedSpecs;
  const bdg = report.bdgRef === 'not-run' ? null : await readJsonArtifact(root, join(root, report.bdgRef), 'BDG') as BDG;
  const diffs: DiffReport[] = []; for (const ref of report.diffReportRefs) diffs.push(await readJsonArtifact(root, join(root, ref), 'DiffReport') as DiffReport);
  const signatures: Signature[] = []; for (const ref of report.signatureRefs) signatures.push(await readJsonArtifact(root, join(root, ref), 'Signature') as Signature);
  const reasoning: ReasoningResult[] = []; for (const ref of report.reasoningRefs) reasoning.push(await readJsonArtifact(root, join(root, ref), 'ReasoningResult'));
  return { report, selected, bdg, diffs, signatures, reasoning };
}
