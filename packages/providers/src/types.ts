export type Ecosystem = 'npm' | 'pypi';

export interface DependencyMatcher {
  ecosystem: Ecosystem;
  package: string;
}

export interface StubContext {
  fixture: unknown;
  onProviderInvoke: () => void;
  recorder: (dottedName: string, sinkKind: 'http_out') => unknown;
}

export interface BoundaryAdapter {
  module: string;
  namedExports: string[];
  requestHeaders?: Record<string, string>;
  interceptionFailurePatterns?: string[];
  createStub(context: StubContext): Record<string, unknown>;
}

export interface FixtureAdapter {
  version?(payload: unknown, meta: Record<string, unknown>, side: 'old' | 'new'): string | undefined;
  ambiguityRoots?(payload: unknown): unknown[];
}

export interface ProvenanceHints {
  envelopePrefix?: string[];
  preserveLiterals?: string[];
}

export type ProviderCapability = 'dependencyMatching' | 'fixtureNormalization' | 'incomingBoundary' | 'outboundSdkBoundary' | 'provenanceHints';

export interface ProviderAdapter {
  id: string;
  displayName: string;
  capabilities: readonly ProviderCapability[];
  dependencyMatchers: DependencyMatcher[];
  defaultUpgrade?: { from: string; to: string };
  fixture?: FixtureAdapter;
  boundaries?: BoundaryAdapter[];
  provenanceHints?: ProvenanceHints;
}

export class ProviderRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderRegistryError';
  }
}
