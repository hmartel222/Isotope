import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { artifactPaths, readJsonArtifact } from '@isotope/core';

export async function explainEntry(configPath: string, entryPoint: string): Promise<{ output: string; exitCode: number }> {
  const root = dirname(resolve(configPath));
  const paths = artifactPaths(root);
  const lines = [`Explain ${entryPoint}`];
  for (const [label, file] of [['SelectedSpecs', paths.selectedSpecs], ['BDG', paths.bdg], ['DiffReport', paths.diffReport], ['Verdict', paths.verdict], ['Report', paths.report]] as const) {
    try {
      await readFile(file);
      lines.push(`${label}: ${file}`);
    } catch {
      lines.push(`${label}: absent`);
    }
  }
  try {
    const report = await readJsonArtifact(paths.root, paths.report, 'IsotopeReport');
    const result = report.verdict.results.find(r => r.entryPointId === entryPoint) ?? report.verdict.results[0];
    if (result) lines.push(`Verdict: ${result.verdict}`, `Reason: ${result.reason}`);
    lines.push(`Verified repairs: ${report.verifiedRepairs.length} (offered only)`);
  } catch {
    lines.push('Report artifact was not readable.');
  }
  return { output: lines.join('\n'), exitCode: 0 };
}
