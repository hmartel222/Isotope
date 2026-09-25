import { resolve } from 'node:path';
import { loadFixturePair as loadSharedFixturePair } from '@isotope/fixtures';
import type { ChangeSpec, FixturePair } from '@isotope/core';
export type { LoadedFixturePair } from '@isotope/fixtures';
export async function loadFixturePair(input: { directory: string; spec: ChangeSpec; pairId: string; role: FixturePair['role']; synthetic: boolean }) {
  const fixtureRoot = resolve(input.directory, '..');
  return loadSharedFixturePair({ fixtureRoot, directory: input.directory, spec: input.spec, pairId: input.pairId, role: input.role, mode: input.synthetic ? 'internal-test' : 'product' });
}
