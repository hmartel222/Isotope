import { lstat, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, parse, relative, resolve, sep } from 'node:path';
import { constants } from 'node:fs';
import { artifactPaths, assertWithinRoot } from './artifact-paths';
import { validateContract } from './validation';
import type { Contract, ContractName } from './contracts';

/** Reject symlink components rather than silently following paths outside the root. */
async function checkNoSymlinks(path: string): Promise<void> {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of relative(current, absolute).split(sep)) {
    current = resolve(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error(`Artifact path contains a symlink: ${current}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  }
}

/** Stable artifact JSON, not the future handler-value serializer. No lossy conversions. */
export function deterministicJson(value: unknown): string {
  const seen = new Set<object>();
  function visit(v: unknown): unknown {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v !== 'object' || !v) throw new Error('Artifact contains a non-JSON value; serialize handler values before writing');
    if (seen.has(v)) throw new Error('Artifact contains a cycle');
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw new Error('Artifact contains a non-JSON object');
    seen.add(v);
    let result: unknown;
    if (Array.isArray(v)) {
      if (Object.keys(v).length !== v.length) throw new Error('Artifact contains a sparse or decorated array');
      result = v.map(visit);
    } else {
      result = Object.fromEntries(Object.keys(v).sort().map(k => [k, visit((v as Record<string, unknown>)[k])]));
    }
    seen.delete(v);
    return result;
  }
  return `${JSON.stringify(visit(value), null, 2)}\n`;
}
export async function ensureArtifactDirectories(projectRoot: string): Promise<void> {
  const paths = artifactPaths(projectRoot);
  for (const directory of [paths.root, ...paths.directories]) {
    await checkNoSymlinks(directory);
    await mkdir(directory, { recursive: true });
  }
}
export async function writeJsonArtifact<N extends ContractName>(root: string, path: string, contract: N, value: Contract<N>): Promise<void> {
  const target = assertWithinRoot(root, path);
  const serialized = deterministicJson(value);
  validateContract(contract, JSON.parse(serialized) as unknown);
  await checkNoSymlinks(target);
  await mkdir(dirname(target), { recursive: true });
  await checkNoSymlinks(target);
  await writeFile(target, serialized, { encoding: 'utf8', flag: constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW });
}
export async function readJsonArtifact<N extends ContractName>(root: string, path: string, contract: N): Promise<Contract<N>> {
  const target = assertWithinRoot(root, path);
  await checkNoSymlinks(target);
  let value: unknown;
  try { value = JSON.parse(await readFile(target, 'utf8')) as unknown; }
  catch (error) { throw new Error(`Cannot read ${contract} artifact ${target}: ${(error as Error).message}`, { cause: error }); }
  return validateContract(contract, value);
}

/** Explicitly discard one stale runtime artifact, with the same containment checks as writes. */
export async function removeJsonArtifact(root: string, path: string): Promise<void> {
  const target = assertWithinRoot(root, path);
  await checkNoSymlinks(target);
  await rm(target, { force: true });
}
