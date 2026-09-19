export * from './selection';
export { loadWalkingSkeletonSpec } from './specimen';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { validateContract, type ChangeSpec, type DraftSpec, type IsotopeConfig, type LoadSelectedSpecs, type NormalizeFixtures, type SelectedSpecs } from '@isotope/core';
import { crossesBreakingThreshold, type DependencyChange } from './selection';

export async function listSpecFiles(registryRoot: string): Promise<string[]> {
  return (await readdir(registryRoot, { recursive: true })).filter(file => /\.ya?ml$/.test(file)).sort();
}

export async function loadHumanSpecs(registryRoot: string): Promise<ChangeSpec[]> {
  const specs: ChangeSpec[] = [];
  for (const file of await listSpecFiles(registryRoot)) {
    const parsed = validateContract('ChangeSpec', parse(await readFile(join(registryRoot, file), 'utf8')) as unknown);
    if (parsed.verified_by === 'human') specs.push(parsed);
  }
  return specs.sort((a, b) => a.id.localeCompare(b.id));
}

export async function loadSpecById(registryRoot: string, id: string): Promise<ChangeSpec> {
  for (const spec of await loadHumanSpecs(registryRoot)) if (spec.id === id) return spec;
  throw new Error(`Unknown human-verified ChangeSpec: ${id}`);
}

function mentions(text: string, pkg: string): boolean {
  const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:from\\s+${escaped}|import\\s+${escaped}|['"]${escaped}['"])`, 'i').test(text);
}

export async function loadSpecsForProject(registryRoot: string, sources: string[], config: IsotopeConfig): Promise<SelectedSpecs> {
  const text = sources.join('\n');
  const humans = await loadHumanSpecs(registryRoot);
  const configuredModules = config.mocks.map(mock => mock.module);
  const matched = humans.filter(spec => Object.values(spec.detection.ecosystems).some(rule =>
    rule.packages.some(pkg => mentions(text, pkg) || configuredModules.includes(pkg))));
  const language = config.language === 'py' || (config.language === 'auto' && config.entryPoints.every(e => e.file.endsWith('.py'))) ? 'py' : 'ts';
  const scoped = matched.filter(spec => spec.detection.taint_roots.some(root => root.language === language));
  const chosen = (scoped.length ? scoped : matched).slice().sort((a, b) => a.id.localeCompare(b.id));
  if (!chosen.length) return validateContract('SelectedSpecs', { schemaVersion: 1, dependencyChanges: [], specs: [] });
  if (chosen.length > 1) throw new Error(`Ambiguous ChangeSpecs for configured sources: ${chosen.map(spec => spec.id).join(', ')}`);
  return validateContract('SelectedSpecs', { schemaVersion: 1, dependencyChanges: [], specs: chosen });
}

export const loadSelectedSpecs: LoadSelectedSpecs = async (input) => {
  let changes: DependencyChange[] = [];
  try { changes = JSON.parse(input.dependencyDiff) as DependencyChange[]; } catch { changes = []; }
  if (!Array.isArray(changes)) changes = [];
  const specs = (await loadHumanSpecs(input.specsPath)).filter(spec => spec.verified_by === 'human' && changes.some(change =>
    Object.entries(spec.detection.ecosystems).some(([eco, rule]) => crossesBreakingThreshold(change, eco, rule.packages, rule.breaking_from))));
  return validateContract('SelectedSpecs', {
    schemaVersion: 1,
    dependencyChanges: changes.map(c => ({ ecosystem: c.ecosystem, package: c.package, from_version: c.fromVersion, to_version: c.toVersion })),
    specs,
  });
};

export const draftSpec: DraftSpec = async (input) => validateContract('ChangeSpec', {
  id: `${input.provider}.draft.${createHash('sha256').update(input.url).digest('hex').slice(0, 8)}`,
  provider: input.provider, title: `Draft ChangeSpec for ${input.provider}`, source: input.url, verified_by: 'draft',
  versions: { from: 'unspecified', to: 'unspecified' },
  semantics: 'Offline draft generated without provider certification. Human verification is required before L1 selection.',
  detection: { ecosystems: { npm: { packages: [input.provider], breaking_from: '0.0.0' } }, taint_roots: [{ kind: 'call', language: 'ts', pattern: '$CLIENT.event($$$)' }] },
  changes: [{ object: 'unspecified', removed_path: 'unspecified_field', replacement: { path: 'replacement.unspecified_field', cardinality: 'one' }, codemod: { kind: 'unsupported' } }],
  fixtures: { pair: 'unspecified' },
});

export async function renderDraftYaml(spec: ChangeSpec): Promise<string> {
  return `# verified_by: draft — this file must not enter L1 until a human sets verified_by: human and verified_at.\n${stringify(spec)}`;
}

export const normalizeFixtures: NormalizeFixtures = async (input) => {
  const files = (await readdir(input.rawDirectory, { recursive: true })).filter(f => /(^|\/)(old|new)\.json$/.test(f)).sort();
  const pairs = new Set(files.map(f => f.replace(/\/(old|new)\.json$/, '')));
  const pairId = input.pairId || [...pairs][0];
  if (!pairId) return { pairId: 'none', metadata: { pairs: 0 } };
  const oldBuf = await readFile(join(input.rawDirectory, pairId, 'old.json'));
  const newBuf = await readFile(join(input.rawDirectory, pairId, 'new.json'));
  const dest = join(input.normalizedDirectory, pairId);
  await mkdir(dest, { recursive: true });
  await writeFile(join(dest, 'old.json'), oldBuf);
  await writeFile(join(dest, 'new.json'), newBuf);
  const metadata = { pair: pairId, envelope: 'copied', sha256: { old: createHash('sha256').update(oldBuf).digest('hex'), new: createHash('sha256').update(newBuf).digest('hex') } };
  await writeFile(join(dest, 'meta.json'), JSON.stringify(metadata, null, 2) + '\n');
  return { pairId, metadata };
};
