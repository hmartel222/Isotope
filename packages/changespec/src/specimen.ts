import { validateContract, type SelectedSpecs } from '@isotope/core';
import { loadSpecById } from './index';

/** Explicit compatibility specimen used by legacy walking-skeleton tests only. */
export async function loadWalkingSkeletonSpec(registryRoot: string, specId: string): Promise<SelectedSpecs> {
  if (!specId.trim()) throw new Error('Compatibility specimen requires an explicit ChangeSpec identifier');
  const spec = await loadSpecById(registryRoot, specId);
  return validateContract('SelectedSpecs', { schemaVersion: 1, dependencyChanges: [], specs: [spec] });
}
