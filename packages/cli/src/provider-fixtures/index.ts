import type { JsonValue } from '@isotope/core';
import { stripeFixtureValidator } from './stripe';
import type { ProviderFixtureValidator } from './types';

const validators: ProviderFixtureValidator[] = [stripeFixtureValidator];

/** Unknown providers use the generic JSON/provenance checks only. */
export function validateProviderFixtures(provider: string, payloads: [JsonValue, JsonValue]): void {
  const validator = validators.find(candidate => candidate.provider === provider);
  if (!validator) return;
  validator.validate(payloads[0], 'old');
  validator.validate(payloads[1], 'new');
}
