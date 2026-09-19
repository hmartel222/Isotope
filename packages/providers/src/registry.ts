import { ProviderRegistryError, type BoundaryAdapter, type DependencyMatcher, type ProviderAdapter } from './types';

export class ProviderRegistry {
  private readonly providers = new Map<string, ProviderAdapter>();

  constructor(initial: readonly ProviderAdapter[] = []) {
    for (const provider of [...initial].sort((a, b) => a.id.localeCompare(b.id))) this.register(provider);
  }

  register(provider: ProviderAdapter): void {
    if (this.providers.has(provider.id)) throw new ProviderRegistryError(`Duplicate provider id: ${provider.id}`);
    if (!provider.dependencyMatchers.length) throw new ProviderRegistryError(`Provider ${provider.id} must declare dependency matchers`);
    for (const boundary of provider.boundaries ?? []) {
      const owner = this.list().find(existing => existing.boundaries?.some(item => item.module === boundary.module));
      if (owner) throw new ProviderRegistryError(`Ambiguous boundary module ${boundary.module}: ${owner.id} and ${provider.id}`);
    }
    this.providers.set(provider.id, provider);
  }

  get(id: string): ProviderAdapter {
    const provider = this.providers.get(id);
    if (!provider) throw new ProviderRegistryError(`Unknown provider: ${id}`);
    return provider;
  }

  tryGet(id: string): ProviderAdapter | undefined {
    return this.providers.get(id);
  }

  list(): ProviderAdapter[] {
    return [...this.providers.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  match(change: DependencyMatcher): ProviderAdapter {
    const hits = this.list().filter(provider => provider.dependencyMatchers.some(matcher =>
      matcher.ecosystem === change.ecosystem && matcher.package === change.package));
    if (!hits.length) throw new ProviderRegistryError(`No provider matches ${change.ecosystem}:${change.package}`);
    if (hits.length > 1) throw new ProviderRegistryError(`Ambiguous providers for ${change.ecosystem}:${change.package}: ${hits.map(h => h.id).join(', ')}`);
    return hits[0]!;
  }

  boundaryForModule(moduleId: string): BoundaryAdapter | undefined {
    for (const provider of this.list()) {
      const boundary = provider.boundaries?.find(item => item.module === moduleId);
      if (boundary) return boundary;
    }
    return undefined;
  }

  requireCapability(id: string, capability: ProviderAdapter['capabilities'][number]): ProviderAdapter {
    const provider = this.get(id);
    if (!provider.capabilities.includes(capability)) throw new ProviderRegistryError(`Provider ${id} does not implement ${capability}`);
    return provider;
  }
}

let builtins: ProviderRegistry | undefined;

export function createRegistry(providers: readonly ProviderAdapter[]): ProviderRegistry {
  return new ProviderRegistry(providers);
}

export function setBuiltinRegistry(registry: ProviderRegistry): void {
  builtins = registry;
}

export function getBuiltinRegistry(): ProviderRegistry {
  if (!builtins) throw new ProviderRegistryError('Builtin provider registry is not initialized');
  return builtins;
}
