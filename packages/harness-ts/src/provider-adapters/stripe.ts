import type { ProviderAdapterDescriptor } from './types';

export const stripeAdapter: ProviderAdapterDescriptor = {
  id: 'stripe-webhook',
  module: 'stripe',
  exports: ['default', 'Stripe'],
  intercept: ['webhooks.constructEvent', 'webhooks.constructEventAsync'],
  requestHeaders: { 'stripe-signature': 'isotope-mocked-signature' },
  records: { 'subscriptions.retrieve': 'http_out' },
  errorPatterns: ['StripeSignatureVerificationError', 'signature verification', 'webhook signature'],
};
