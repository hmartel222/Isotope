import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import type { ChangeSpec, DependencyBinding, EvidenceBinding, FixturePair, JsonValue } from '@isotope/core';

const MAX_FILE_BYTES = 8 * 1024 * 1024;
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function inside(root: string, target: string): boolean { const rel = relative(root, target); return rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel); }
async function safeJson(root: string, path: string, label: string): Promise<{ value: unknown; hash: string; path: string }> {
  const requestedRoot = resolve(root); const actualRoot = await realpath(requestedRoot); const candidate = resolve(path);
  if (!inside(requestedRoot, candidate)) throw new Error(`${label} escapes fixture root`);
  const actual = await realpath(candidate); if (!inside(actualRoot, actual)) throw new Error(`${label} resolves outside fixture root`);
  const stat = await lstat(actual); if (!stat.isFile()) throw new Error(`${label} must be a regular file`);
  if (stat.size > MAX_FILE_BYTES) throw new Error(`${label} exceeds ${MAX_FILE_BYTES} bytes`);
  const data = await readFile(actual); let value: unknown;
  try { value = JSON.parse(data.toString('utf8')) as unknown; } catch (error) { throw new Error(`${label} is invalid JSON: ${(error as Error).message}`); }
  return { value, hash: createHash('sha256').update(data).digest('hex'), path: actual };
}
function text(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function normalizedDependencyVersion(value: string | undefined, packageName: string): string | undefined {
  if (!value) return undefined;
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return value.replace(new RegExp(`^${escaped}(?:==|@)`, 'i'), '');
}

export interface LoadedFixturePair { fixture: FixturePair; payloads: [JsonValue, JsonValue]; metadata: Record<string, unknown>; hashes: Record<string, string>; provenance: string; synthetic: boolean }
export async function loadFixturePair(input: { fixtureRoot: string; directory: string; spec: ChangeSpec; pairId: string; role: FixturePair['role']; mode: 'product'|'internal-test' }): Promise<LoadedFixturePair> {
  const directory = resolve(input.directory);
  let oldFile: Awaited<ReturnType<typeof safeJson>>, newFile: Awaited<ReturnType<typeof safeJson>>, metaFile: Awaited<ReturnType<typeof safeJson>>;
  try { [oldFile, newFile, metaFile] = await Promise.all(['old.json', 'new.json', 'meta.json'].map(file => safeJson(input.fixtureRoot, resolve(directory, file), `${input.pairId}/${file}`))) as [Awaited<ReturnType<typeof safeJson>>, Awaited<ReturnType<typeof safeJson>>, Awaited<ReturnType<typeof safeJson>>]; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`BLOCKER: provider fixture pair ${input.pairId} is absent`); throw error; }
  if (oldFile.path === newFile.path) throw new Error('Old and new fixture payloads must be distinct files');
  const oldPayload = object(oldFile.value, 'old fixture') as JsonValue; const newPayload = object(newFile.value, 'new fixture') as JsonValue;
  const metadata = object(metaFile.value, 'fixture metadata');
  if (input.mode === 'product' && text(metadata.pair) && metadata.pair !== input.pairId) throw new Error(`Fixture metadata pair ${metadata.pair} does not match ${input.pairId}`);
  const synthetic = metadata.synthetic === true;
  if (input.mode === 'internal-test' && !synthetic) throw new Error('Internal test fixtures must explicitly declare meta.synthetic: true');
  if (input.mode === 'product' && synthetic) throw new Error('Synthetic fixtures are forbidden in product fixture directories');
  const provenance = text(metadata.provenance) ?? (metadata.envelope === 'provider' ? 'provider' : synthetic ? 'internal-controlled' : undefined);
  if (!provenance) throw new Error('Fixture metadata requires provenance');
  const nestedOld = object(metadata.old ?? {}, 'fixture metadata.old'); const nestedNew = object(metadata.new ?? {}, 'fixture metadata.new');
  const oldVersion = text(metadata.oldVersion) ?? text(nestedOld.apiVersion) ?? input.spec.versions.from;
  const newVersion = text(metadata.newVersion) ?? text(nestedNew.apiVersion) ?? input.spec.versions.to;
  if (oldVersion === newVersion) throw new Error('Fixture metadata needs distinct old/new version labels');
  const declaredHashes = object(metadata.hashes ?? {}, 'fixture metadata.hashes');
  const declaredOld = text(metadata.oldSha256) ?? text(declaredHashes.old); const declaredNew = text(metadata.newSha256) ?? text(declaredHashes.new);
  if (declaredOld && declaredOld !== oldFile.hash) throw new Error('Fixture metadata old payload hash mismatch');
  if (declaredNew && declaredNew !== newFile.hash) throw new Error('Fixture metadata new payload hash mismatch');
  return { fixture: { id: synthetic ? `synthetic-${input.pairId}` : input.pairId, role: input.role, oldPath: resolve(directory, 'old.json'), newPath: resolve(directory, 'new.json'), oldVersion, newVersion }, payloads: [oldPayload, newPayload], metadata, hashes: { [`${input.pairId}/old.json`]: oldFile.hash, [`${input.pairId}/new.json`]: newFile.hash, [`${input.pairId}/meta.json`]: metaFile.hash }, provenance, synthetic };
}

export async function createFixtureEvidenceBinding(input: { fixturesRoot: string; pair: string; heldoutPair?: string; dependencyBinding: DependencyBinding; mode: 'product'|'internal-test' }): Promise<EvidenceBinding> {
  if (input.heldoutPair && input.heldoutPair === input.pair) throw new Error('Planning and held-out fixture pairs must differ');
  const provisional = (pair: string): ChangeSpec => ({ id: 'fixture-validation-only', provider: input.dependencyBinding.package, title: 'fixture validation only', source: 'host', verified_by: 'draft', versions: { from: input.dependencyBinding.fromVersion, to: input.dependencyBinding.toVersion }, semantics: 'fixture validation only', detection: { ecosystems: { [input.dependencyBinding.ecosystem]: { packages: [input.dependencyBinding.package], breaking_from: input.dependencyBinding.toVersion } }, taint_roots: [{ kind: 'call', language: 'ts', pattern: '$HOST.call($$$)' }] }, changes: [{ object: 'fixture', removed_path: 'old', replacement: { path: 'new', cardinality: 'one' } }], fixtures: { pair } });
  const ids = [input.pair, ...(input.heldoutPair ? [input.heldoutPair] : [])];
  const loaded = await Promise.all(ids.map((pair, index) => loadFixturePair({ fixtureRoot: input.fixturesRoot, directory: resolve(input.fixturesRoot, pair), spec: provisional(pair), pairId: pair, role: index ? 'held_out' : 'planning', mode: input.mode })));
  for (const item of loaded) {
    const oldDeclared = normalizedDependencyVersion(text(item.metadata.oldVersion), input.dependencyBinding.package);
    const newDeclared = normalizedDependencyVersion(text(item.metadata.newVersion), input.dependencyBinding.package);
    if (oldDeclared && oldDeclared !== input.dependencyBinding.fromVersion) throw new Error(`Fixture old version ${oldDeclared} does not match dependency ${input.dependencyBinding.fromVersion}`);
    if (newDeclared && newDeclared !== input.dependencyBinding.toVersion) throw new Error(`Fixture new version ${newDeclared} does not match dependency ${input.dependencyBinding.toVersion}`);
  }
  const first = loaded[0]!;
  return { status: 'bound', pair: input.pair, ...(input.heldoutPair ? { heldoutPair: input.heldoutPair } : {}), oldVersion: first.fixture.oldVersion, newVersion: first.fixture.newVersion, provenance: first.provenance, synthetic: first.synthetic, fixtureHashes: Object.assign({}, ...loaded.map(item => item.hashes)) };
}
