import type { JsonValue } from '@isotope/core';

export interface ProviderFixtureValidator {
  provider: string;
  validate(payload: JsonValue, side: 'old' | 'new'): void;
}
