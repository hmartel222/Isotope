import type { ProviderAdapter, StubContext } from '../types';

/** Synthetic list/pagination provider for the provider-interface suite. Not a production vendor. */
export const itemsProvider: ProviderAdapter = {
  id: 'isotope-items',
  displayName: 'Isotope test items',
  capabilities: ['dependencyMatching', 'outboundSdkBoundary', 'provenanceHints'],
  dependencyMatchers: [{ ecosystem: 'npm', package: '@isotope/test-items' }],
  defaultUpgrade: { from: '1.0.0', to: '2.0.0' },
  provenanceHints: { preserveLiterals: ['items', 'nextCursor'] },
  boundaries: [{
    module: '@isotope/test-items',
    namedExports: ['Client'],
    createStub(context: StubContext) {
      class Client {
        items = {
          list: async () => { context.onProviderInvoke(); return structuredClone(context.fixture); },
        };
      }
      return { Client, default: Client };
    },
  }],
};
