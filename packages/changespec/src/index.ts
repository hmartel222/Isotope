import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { NotImplementedStageError, validateContract, type DraftSpec, type LoadSelectedSpecs, type NormalizeFixtures, type SelectedSpecs } from '@isotope/core';

/** PHASE 2 WALKING-SKELETON LIMITATION: explicit spec, no manifest/dependency selection. */
export async function loadWalkingSkeletonSpec(registryRoot: string): Promise<SelectedSpecs> {
  const files = (await readdir(registryRoot, { recursive: true })).filter(file => /\.ya?ml$/.test(file));
  if (files.length !== 1 || files[0] !== 'stripe/basil-subscription-period.yaml') throw new Error('Phase 2 requires exactly one known ChangeSpec: stripe/basil-subscription-period.yaml; dependency selection is not implemented');
  const path = join(registryRoot, 'stripe/basil-subscription-period.yaml');
  const spec = validateContract('ChangeSpec', parse(await readFile(path, 'utf8')) as unknown);
  if (spec.id !== 'stripe.basil.subscription-period' || spec.provider !== 'stripe') throw new Error('Phase 2 supports only stripe.basil.subscription-period');
  // The SelectedSpecs validator refuses draft/unverified input.
  return validateContract('SelectedSpecs', { schemaVersion: 1, dependencyChanges: [], specs: [spec] });
}
export const loadSelectedSpecs: LoadSelectedSpecs = (_input) => { throw new NotImplementedStageError('changespec.loadSelectedSpecs'); };
export const draftSpec: DraftSpec = (_input) => { throw new NotImplementedStageError('changespec.draftSpec'); };
export const normalizeFixtures: NormalizeFixtures = (_input) => { throw new NotImplementedStageError('changespec.normalizeFixtures'); };
