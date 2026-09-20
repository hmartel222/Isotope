import { validateContract, type SelectedSpecs } from '@isotope/core';
import { loadHumanSpecs } from './index';

/** Explicit compatibility specimen used by legacy walking-skeleton tests only. */
export async function loadWalkingSkeletonSpec(registryRoot: string): Promise<SelectedSpecs> {
  const specs = await loadHumanSpecs(registryRoot);
  const ranked = specs.slice().sort((a, b) => b.changes.length - a.changes.length || a.id.localeCompare(b.id));
  const spec = ranked[0];
  if (!spec || (ranked[1] && ranked[1].changes.length === spec.changes.length)) {
    throw new Error(`Compatibility specimen requires a unique most-comprehensive human-verified spec; found ${specs.length}`);
  }
  return validateContract('SelectedSpecs', { schemaVersion: 1, dependencyChanges: [], specs: [spec] });
}
