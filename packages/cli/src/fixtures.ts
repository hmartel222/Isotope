import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ChangeSpec, FixturePair, JsonValue } from '@isotope/core';

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

export interface LoadedFixturePair {
  fixture: FixturePair;
  payloads: [JsonValue, JsonValue];
  metadata: Record<string, unknown>;
}

export async function loadFixturePair(input: {
  directory: string; spec: ChangeSpec; pairId: string; role: FixturePair['role']; synthetic: boolean;
}): Promise<LoadedFixturePair> {
  const oldPath = resolve(input.directory, 'old.json');
  const newPath = resolve(input.directory, 'new.json');
  const metaPath = resolve(input.directory, 'meta.json');
  let files: string[];
  try { files = await Promise.all([oldPath, newPath, metaPath].map(path => readFile(path, 'utf8'))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`BLOCKER: provider fixture pair ${input.pairId} is absent.\nExpected:\n${oldPath}\n${newPath}\n${metaPath}`);
    throw error;
  }
  const payloads = [JSON.parse(files[0]!) as JsonValue, JSON.parse(files[1]!) as JsonValue] as [JsonValue, JsonValue];
  // Payload shape belongs to the pack. The portable core validates only the
  // JSON/provenance contract and never dispatches on a provider name.
  object(payloads[0], 'old fixture');
  object(payloads[1], 'new fixture');
  const metadata = object(JSON.parse(files[2]!) as unknown, 'fixture metadata');
  if (input.synthetic && metadata.synthetic !== true) throw new Error('Internal test fixtures must explicitly declare meta.synthetic: true');
  if (!input.synthetic && metadata.synthetic === true) throw new Error('Synthetic fixtures are forbidden in product fixture directories');
  const hasProvenance = (typeof metadata.provenance === 'string' && metadata.provenance.length > 0)
    || metadata.envelope === 'provider' || metadata.synthetic === true;
  if (!hasProvenance) throw new Error('Fixture metadata requires provenance');
  const nestedOld = object(metadata.old ?? {}, 'fixture metadata.old');
  const nestedNew = object(metadata.new ?? {}, 'fixture metadata.new');
  const oldVersion = typeof metadata.oldVersion === 'string' && metadata.oldVersion ? metadata.oldVersion
    : typeof nestedOld.apiVersion === 'string' && nestedOld.apiVersion ? nestedOld.apiVersion : input.spec.versions.from;
  const newVersion = typeof metadata.newVersion === 'string' && metadata.newVersion ? metadata.newVersion
    : typeof nestedNew.apiVersion === 'string' && nestedNew.apiVersion ? nestedNew.apiVersion : input.spec.versions.to;
  if (oldVersion === newVersion) throw new Error('Fixture metadata needs distinct old/new version labels');
  return {
    fixture: { id: input.synthetic ? `synthetic-${input.pairId}` : input.pairId, role: input.role, oldPath, newPath, oldVersion, newVersion },
    payloads, metadata,
  };
}
