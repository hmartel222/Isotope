import type { ProviderAdapter } from '../types';

/** Python SDK only. The TS harness does not install an ElevenLabs boundary. */
export const elevenlabsProvider: ProviderAdapter = {
  id: 'elevenlabs',
  displayName: 'ElevenLabs',
  capabilities: ['dependencyMatching', 'fixtureNormalization', 'provenanceHints'],
  dependencyMatchers: [{ ecosystem: 'pypi', package: 'elevenlabs' }],
  defaultUpgrade: { from: '0.2.27', to: '1.0.0' },
  provenanceHints: { preserveLiterals: ['voice_id', 'generate'] },
};
