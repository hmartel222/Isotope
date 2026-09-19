import type { ProviderAdapter, StubContext } from '../types';

/** Synthetic SDK-response provider for the provider-interface suite. Not a production vendor. */
export const accountsProvider: ProviderAdapter = {
  id: 'isotope-accounts',
  displayName: 'Isotope test accounts',
  capabilities: ['dependencyMatching', 'outboundSdkBoundary', 'provenanceHints'],
  dependencyMatchers: [{ ecosystem: 'npm', package: '@isotope/test-accounts' }],
  defaultUpgrade: { from: '1.0.0', to: '2.0.0' },
  provenanceHints: { preserveLiterals: ['renewal'] },
  boundaries: [{
    module: '@isotope/test-accounts',
    namedExports: ['Client'],
    createStub(context: StubContext) {
      class Client {
        accounts = {
          retrieve: async () => { context.onProviderInvoke(); return structuredClone(context.fixture); },
        };
      }
      return { Client, default: Client };
    },
  }],
};
