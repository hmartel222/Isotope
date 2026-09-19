import type { SinkKind } from '@isotope/core';

export interface ProviderAdapterDescriptor {
  id: string;
  module: string;
  exports: string[];
  intercept: string[];
  requestHeaders: Record<string, string>;
  records: Record<string, SinkKind>;
  errorPatterns: string[];
}

export interface ProviderMockConfig {
  module: string;
  strategy: 'provider';
  adapter?: string;
  intercept?: string[];
  exports?: string[];
  requestHeaders?: Record<string, string>;
  records?: Record<string, SinkKind>;
}
