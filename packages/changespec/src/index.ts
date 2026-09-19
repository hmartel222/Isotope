export * from './selection';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { validateContract, type SelectedSpecs } from '@isotope/core';
export async function loadWalkingSkeletonSpec(registryRoot: string): Promise<SelectedSpecs> {
  const files = (await readdir(registryRoot, { recursive: true })).filter(file => /\.ya?ml$/.test(file));
  if (files.length !== 1 || files[0] !== 'stripe/basil-subscription-period.yaml') throw new Error('Phase 2 requires exactly one known ChangeSpec: stripe/basil-subscription-period.yaml; dependency selection is not implemented');
  const spec = validateContract('ChangeSpec', parse(await readFile(join(registryRoot, files[0]), 'utf8')) as unknown);
  if (spec.verified_by !== 'human' || !spec.verified_at) throw new Error('Walking-skeleton spec must be human verified');
  return validateContract('SelectedSpecs', { schemaVersion: 1, dependencyChanges: [], specs: [spec] });
}
import { NotImplementedStageError, type DraftSpec, type LoadSelectedSpecs, type NormalizeFixtures } from '@isotope/core';
export const loadSelectedSpecs: LoadSelectedSpecs = (_input) => { throw new NotImplementedStageError('changespec.loadSelectedSpecs'); };
export const draftSpec: DraftSpec = (_input) => { throw new NotImplementedStageError('changespec.draftSpec'); };
export const normalizeFixtures: NormalizeFixtures = (_input) => { throw new NotImplementedStageError('changespec.normalizeFixtures'); };
