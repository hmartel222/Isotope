import { HarnessExecutionError } from '../errors';
import { stripeAdapter } from './stripe';
import type { ProviderAdapterDescriptor, ProviderMockConfig } from './types';

const builtins: ProviderAdapterDescriptor[] = [stripeAdapter];

function unique(values: string[], label: string): string[] {
  const result = [...new Set(values.filter(Boolean))];
  if (!result.length) throw new HarnessExecutionError('unsupported_harness_plan', `${label} must not be empty`);
  return result;
}

export function resolveProviderAdapter(mock: ProviderMockConfig): ProviderAdapterDescriptor {
  if (mock.adapter === 'fixture-call') {
    return {
      id: 'fixture-call', module: mock.module,
      exports: unique(mock.exports ?? ['default'], 'provider exports'),
      intercept: unique(mock.intercept ?? [], 'provider intercept paths'),
      requestHeaders: { ...(mock.requestHeaders ?? {}) }, records: { ...(mock.records ?? {}) }, errorPatterns: [],
    };
  }
  const adapter = builtins.find(item => item.id === mock.adapter || (!mock.adapter && item.module === mock.module));
  if (!adapter) throw new HarnessExecutionError('unsupported_harness_plan', `Unknown provider adapter for module ${mock.module}`);
  return { ...adapter, module: mock.module,
    requestHeaders: { ...adapter.requestHeaders, ...(mock.requestHeaders ?? {}) },
    intercept: mock.intercept ? unique(mock.intercept, 'provider intercept paths') : [...adapter.intercept],
    exports: mock.exports ? unique(mock.exports, 'provider exports') : [...adapter.exports],
    records: { ...adapter.records, ...(mock.records ?? {}) } };
}

export type { ProviderAdapterDescriptor, ProviderMockConfig } from './types';
