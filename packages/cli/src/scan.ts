import { readFile, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';
import { artifactPaths, validateContract, writeJsonArtifact, type BDG, type SelectedSpecs } from '@isotope/core';
import { loadSpecById, loadSpecsForProject } from '@isotope/changespec';
import { resolveBehavioralDependencyGraph as resolveTs } from '@isotope/resolver-ts';
import { resolveBehavioralDependencyGraph as resolvePy } from '@isotope/resolver-py';

export function usesPython(config: { language: 'ts' | 'py' | 'auto'; entryPoints: { file: string }[] }): boolean {
  if (config.language === 'py') return true;
  if (config.language === 'ts') return false;
  const py = config.entryPoints.some(e => e.file.endsWith('.py'));
  const ts = config.entryPoints.some(e => !e.file.endsWith('.py'));
  if (py && ts) throw new Error('language: auto does not mix Python and TypeScript entry points in one configuration');
  return py;
}

export async function analyzeConfiguredProject(configPath: string, selectedOverride?: SelectedSpecs, specsPath?: string, specId?: string) {
  const path = await realpath(resolve(configPath)); const projectRoot = dirname(path);
  const config = validateContract('IsotopeConfig', parse(await readFile(path, 'utf8')) as unknown);
  const sources = await Promise.all(config.entryPoints.map(async e => {
    try { return `${e.file}\n${await readFile(resolve(projectRoot, e.file), 'utf8')}`; } catch { return e.file; }
  }));
  const registryRoot = specsPath ? resolve(projectRoot, specsPath) : resolve(__dirname, '../../../specs');
  let selected = selectedOverride;
  if (!selected && specId) {
    const spec = await loadSpecById(registryRoot, specId);
    selected = validateContract('SelectedSpecs', { schemaVersion: 1, dependencyChanges: [], specs: [spec] });
  }
  selected ??= await loadSpecsForProject(registryRoot, sources, config);
  if (selected.specs.length !== 1) throw new Error('No matching human-verified ChangeSpec for configured sources');
  const python = usesPython(config);
  const bdg = python
    ? await resolvePy({ repositoryRoot: projectRoot, config, changeSpec: selected.specs[0]! })
    : await resolveTs({ repositoryRoot: projectRoot, config, changeSpec: selected.specs[0]! });
  return { projectRoot, config, selected, bdg, python };
}
export function graphSummary(bdg: BDG): string[] {
  const language = bdg.entryPoints[0]?.language === 'py' ? 'Python' : 'TypeScript/JavaScript';
  const lines = [`BDG: generated ${language} analysis`, 'Bounds: 200 customer files; one local-function hop; one provider re-export hop'];
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
export async function scanProject(configPath: string, options: { specsPath?: string; specId?: string } = {}): Promise<string> {
  const { projectRoot, selected, bdg } = await analyzeConfiguredProject(configPath, undefined, options.specsPath, options.specId);
  const paths = artifactPaths(projectRoot);
  await writeJsonArtifact(paths.root, paths.bdg, 'BDG', bdg);
  return [`ChangeSpec: ${selected.specs[0]!.id}`, ...graphSummary(bdg), `BDG artifact: ${paths.bdg}`].join('\n');
}
