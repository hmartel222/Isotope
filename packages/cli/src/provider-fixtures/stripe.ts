import type { ProviderFixtureValidator } from './types';

export const stripeFixtureValidator: ProviderFixtureValidator = {
  provider: 'stripe',
  validate(payload, side) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error(`${side} Stripe fixture must be an event object`);
    const event = payload as Record<string, unknown>;
    const data = event.data;
    if (!data || typeof data !== 'object' || Array.isArray(data) || !(data as Record<string, unknown>).object) {
      throw new Error(`${side} Stripe fixture requires data.object`);
    }
  },
};
