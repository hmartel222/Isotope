import { asRecord } from '../envelope';
import type { ProviderAdapter, StubContext } from '../types';

function throwIfProviderError(fixture: unknown): void {
  const record = asRecord(fixture);
  const error = asRecord(record?.error);
  if (!error) return;
  const failure = new Error(typeof error.message === 'string' ? error.message : 'Snowflake provider error');
  failure.name = typeof error.name === 'string' ? error.name : 'Error';
  throw failure;
}

/** Synthetic outbound snowflake-sdk provider. Not production-validated Snowflake support. */
export const snowflakeProvider: ProviderAdapter = {
  id: 'snowflake',
  displayName: 'Snowflake',
  capabilities: ['dependencyMatching', 'fixtureNormalization', 'outboundSdkBoundary', 'provenanceHints'],
  dependencyMatchers: [{ ecosystem: 'npm', package: 'snowflake-sdk' }],
  defaultUpgrade: { from: '1.9.0', to: '2.0.0' },
  provenanceHints: { preserveLiterals: ['ACCOUNT_RENEWAL', 'RENEWAL', 'execute', 'createConnection'] },
  fixture: {
    ambiguityRoots: (payload) => {
      const rows = asRecord(payload)?.rows;
      return Array.isArray(rows) ? [rows, payload] : [payload];
    },
  },
  boundaries: [{
    module: 'snowflake-sdk',
    namedExports: [],
    createStub(context: StubContext) {
      const createConnection = () => ({
        execute: async () => {
          context.onProviderInvoke();
          const fixture = structuredClone(context.fixture);
          throwIfProviderError(fixture);
          return fixture;
        },
      });
      return { createConnection, default: { createConnection } };
    },
  }],
};
