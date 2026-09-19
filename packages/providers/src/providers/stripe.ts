import { asRecord } from '../envelope';
import type { ProviderAdapter, StubContext } from '../types';

function stripeEventVersion(payload: unknown): string | undefined {
  const event = asRecord(payload);
  const data = asRecord(event?.data);
  const object = asRecord(data?.object);
  if (event?.object !== 'event' || event.type !== 'customer.subscription.updated' || typeof event.api_version !== 'string' || !event.api_version) return undefined;
  if (object?.object !== 'subscription' || typeof object.id !== 'string') return undefined;
  return event.api_version;
}

export const stripeProvider: ProviderAdapter = {
  id: 'stripe',
  displayName: 'Stripe',
  capabilities: ['dependencyMatching', 'fixtureNormalization', 'incomingBoundary', 'outboundSdkBoundary', 'provenanceHints'],
  dependencyMatchers: [
    { ecosystem: 'npm', package: 'stripe' },
    { ecosystem: 'pypi', package: 'stripe' },
  ],
  defaultUpgrade: { from: '17.7.0', to: '18.1.0' },
  provenanceHints: { envelopePrefix: ['data', 'object'], preserveLiterals: ['current_period_end', 'subscription'] },
  fixture: {
    version: (payload) => stripeEventVersion(payload),
    ambiguityRoots: (payload) => {
      const object = asRecord(asRecord(asRecord(payload)?.data)?.object);
      return object ? [object, payload] : [payload];
    },
  },
  boundaries: [{
    module: 'stripe',
    namedExports: ['Stripe'],
    requestHeaders: { 'stripe-signature': 'isotope-mocked-signature' },
    interceptionFailurePatterns: ['StripeSignatureVerificationError', 'signature verification', 'webhook signature'],
    createStub(context: StubContext) {
      class Stripe {
        webhooks = {
          constructEvent: () => { context.onProviderInvoke(); return structuredClone(context.fixture); },
          constructEventAsync: async () => { context.onProviderInvoke(); return structuredClone(context.fixture); },
        };
        subscriptions = { retrieve: context.recorder('stripe.subscriptions.retrieve', 'http_out') };
      }
      return { default: Stripe, Stripe };
    },
  }],
};
