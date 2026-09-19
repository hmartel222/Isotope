import './builtins';
import { readMetaVersion } from './envelope';
import { getBuiltinRegistry } from './registry';
import type { BoundaryAdapter, StubContext } from './types';

export type { BoundaryAdapter, DependencyMatcher, FixtureAdapter, ProviderAdapter, ProviderCapability, ProvenanceHints, StubContext } from './types';
export { ProviderRegistryError } from './types';
export { ProviderRegistry, createRegistry, getBuiltinRegistry, setBuiltinRegistry } from './registry';
export { builtinProviders } from './builtins';
export { accountsProvider } from './providers/accounts';
export { elevenlabsProvider } from './providers/elevenlabs';
export { googlemapsProvider } from './providers/googlemaps';
export { itemsProvider } from './providers/items';
export { snowflakeProvider } from './providers/snowflake';
export { stripeProvider } from './providers/stripe';

export function listProviders() {
  return getBuiltinRegistry().list();
}

export function getProvider(id: string) {
  return getBuiltinRegistry().get(id);
}

export function tryGetProvider(id: string) {
  return getBuiltinRegistry().tryGet(id);
}

export function matchProviderForDependency(change: { ecosystem: 'npm' | 'pypi'; package: string }) {
  return getBuiltinRegistry().match(change);
}

export function getBoundaryForModule(moduleId: string): BoundaryAdapter | undefined {
  return getBuiltinRegistry().boundaryForModule(moduleId);
}

export function namedExportsForModule(moduleId: string): string[] {
  return getBoundaryForModule(moduleId)?.namedExports ?? [];
}

export function createProviderStub(moduleId: string, context: StubContext): Record<string, unknown> {
  const boundary = getBoundaryForModule(moduleId);
  if (!boundary) throw new Error(`No provider boundary registered for ${moduleId}`);
  return boundary.createStub(context);
}

export function envelopePrefixFor(providerId: string): string[] {
  return tryGetProvider(providerId)?.provenanceHints?.envelopePrefix ?? [];
}

export function preserveLiteralsFor(providerId: string): string[] {
  return tryGetProvider(providerId)?.provenanceHints?.preserveLiterals ?? [];
}

export function resolveFixtureVersion(payload: unknown, meta: Record<string, unknown> | undefined, side: 'old' | 'new', providerId: string): string {
  const labeled = readMetaVersion(meta, side);
  if (labeled) return labeled;
  const version = tryGetProvider(providerId)?.fixture?.version?.(payload, meta ?? {}, side);
  if (version) return version;
  throw new Error(`${side} fixture: expected meta.${side === 'new' ? 'newVersion' : 'oldVersion'} or a ${providerId} fixture adapter version`);
}

export function ambiguityRootsFor(payload: unknown, providerId: string): unknown[] {
  const roots = tryGetProvider(providerId)?.fixture?.ambiguityRoots?.(payload);
  if (roots?.length) return roots;
  return [payload];
}
