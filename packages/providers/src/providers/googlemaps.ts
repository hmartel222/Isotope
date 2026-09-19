import type { ProviderAdapter, StubContext } from '../types';

export const googlemapsProvider: ProviderAdapter = {
  id: 'googlemaps',
  displayName: 'Google Maps',
  capabilities: ['dependencyMatching', 'fixtureNormalization', 'outboundSdkBoundary', 'provenanceHints'],
  dependencyMatchers: [{ ecosystem: 'npm', package: '@googlemaps/google-maps-services-js' }],
  defaultUpgrade: { from: '3.4.2', to: '4.0.0' },
  provenanceHints: { preserveLiterals: ['formatted_address', 'formattedAddress', 'placeDetails'] },
  boundaries: [{
    module: '@googlemaps/google-maps-services-js',
    namedExports: ['Client'],
    createStub(context: StubContext) {
      class Client {
        async placeDetails() {
          context.onProviderInvoke();
          return { data: structuredClone(context.fixture) };
        }
      }
      return { Client, default: Client };
    },
  }],
};
