import { readFile, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';
import { artifactPaths, validateContract, writeJsonArtifact, type BDG, type SelectedSpecs } from '@isotope/core';
import { loadWalkingSkeletonSpec } from '@isotope/changespec';
import { resolveBehavioralDependencyGraph } from '@isotope/resolver-ts';

export async function analyzeConfiguredProject(configPath: string, selectedOverride?: SelectedSpecs) {
  const path = await realpath(resolve(configPath)); const projectRoot = dirname(path);
  const config = validateContract('IsotopeConfig', parse(await readFile(path, 'utf8')) as unknown);
  const selected = selectedOverride ?? await loadWalkingSkeletonSpec(resolve(__dirname, '../../../specs'));
  const bdg = await resolveBehavioralDependencyGraph({ repositoryRoot: projectRoot, config, changeSpec: selected.specs[0]! });
  return { projectRoot, config, selected, bdg };
}
export function graphSummary(bdg: BDG): string[] {
  const lines = [`BDG: generated TypeScript/JavaScript analysis`, 'Bounds: 200 customer files; one local-function hop; one provider re-export hop'];
  for (const entry of bdg.entryPoints) {
    const roots = bdg.nodes.filter(n => n.entryPointId === entry.id && n.kind === 'taint_root');
    const sites = bdg.affectedSites.filter(s => s.entryPointId === entry.id);
    lines.push(`Entry point: ${entry.file}#${entry.export}`, `Provider roots: ${roots.length}; affected sites: ${sites.length}`);
    const transforms = bdg.nodes.filter(n => n.entryPointId === entry.id && n.kind === 'transform');
    for (const n of transforms) lines.push(`  Transform: ${n.label}${n.aggregation ? ' [aggregation]' : ''} (${n.path ?? '$'})`);
    for (const site of sites) {
      const node = bdg.nodes.find(n => n.id === site.nodeId)!;
      const sinks = site.sinkNodeIds.map(id => bdg.sinks.find(s => s.nodeId === id)!).map(s => `${s.name} (${s.kind})`);
      lines.push(`  ${node.path ?? '$'} [${site.provenance.confidence}] at ${site.location.file}:${site.location.line} -> ${sinks.join(', ') || 'no proven sink'}`);
    }
    for (const sink of bdg.sinks.filter(s => bdg.nodes.some(n => n.id === s.nodeId && n.entryPointId === entry.id))) lines.push(`  Observable sink: ${sink.name} (${sink.kind})`);
  }
  for (const d of bdg.skipped) lines.push(`Diagnostic: ${d.file}: ${d.reason}`);
  return lines;
}
export async function scanProject(configPath: string): Promise<string> {
  const { projectRoot, selected, bdg } = await analyzeConfiguredProject(configPath);
  const paths = artifactPaths(projectRoot);
  await writeJsonArtifact(paths.root, paths.bdg, 'BDG', bdg);
  return [`ChangeSpec: ${selected.specs[0]!.id}`, ...graphSummary(bdg), `BDG artifact: ${paths.bdg}`].join('\n');
}
