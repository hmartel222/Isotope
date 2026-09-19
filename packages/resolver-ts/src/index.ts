import { validateContract, type BDG, type ChangeSpec, type EntryPoint, type IsotopeConfig, type ResolveInput } from '@isotope/core';
import { Analyzer, stableId } from './engine';
import { loadProject, slash } from './project';
import { isAbsolute, relative, resolve } from 'node:path';

export interface ResolverInput {
  repositoryRoot: string;
  entryPoints?: IsotopeConfig['entryPoints'];
  changeSpec: ChangeSpec;
  config: IsotopeConfig;
}
/** L2: read-only source analysis, with no fixtures, execution, verdict or repair dependencies. */
export async function resolveBehavioralDependencyGraph(input: ResolverInput | ResolveInput): Promise<BDG> {
  const modern = 'repositoryRoot' in input;
  const config = validateContract('IsotopeConfig', input.config);
  const spec = modern ? input.changeSpec : input.selectedSpecs.specs[0];
  if (!spec || (!modern && input.selectedSpecs.specs.length !== 1)) throw new Error('Resolver requires one explicit ChangeSpec');
  validateContract('ChangeSpec', spec);
  if (spec.verified_by !== 'human') throw new Error('Resolver requires a human-verified ChangeSpec');
  if (config.language === 'py') throw new Error('Python resolver is not implemented');
  const repositoryRoot = modern ? input.repositoryRoot : input.repoRoot;
  const entries: EntryPoint[] = (modern ? input.entryPoints ?? config.entryPoints : config.entryPoints).map(e => {
    const file = slash(relative(resolve(repositoryRoot), resolve(repositoryRoot, e.file)));
    if (file === '..' || file.startsWith('../') || isAbsolute(file)) throw new Error(`Entry point must remain inside repository: ${e.file}`);
    return { ...e, file, id: stableId('ep', file, e.export, e.kind), language: 'ts' as const };
  }).sort((a,b) => a.id.localeCompare(b.id, 'en'));
  if (new Set(entries.map(e => e.id)).size !== entries.length) throw new Error('Duplicate configured entry point');
  const project = loadProject(repositoryRoot, entries.map(e => e.file), config, spec);
  return validateContract('BDG', new Analyzer(project, spec, config, entries).analyze());
}
