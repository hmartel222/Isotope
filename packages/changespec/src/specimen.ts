import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { validateContract, type SelectedSpecs } from '@isotope/core';

/** Explicit compatibility specimen used by legacy walking-skeleton tests only. */
export async function loadWalkingSkeletonSpec(registryRoot: string): Promise<SelectedSpecs> {
  const spec = validateContract('ChangeSpec', parse(await readFile(join(registryRoot, 'stripe/basil-subscription-period.yaml'), 'utf8')) as unknown);
  if (spec.verified_by !== 'human' || !spec.verified_at) throw new Error('Walking-skeleton spec must be human verified');
  return validateContract('SelectedSpecs', { schemaVersion: 1, dependencyChanges: [], specs: [spec] });
}
