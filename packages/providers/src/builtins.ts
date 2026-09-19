import { accountsProvider } from './providers/accounts';
import { elevenlabsProvider } from './providers/elevenlabs';
import { googlemapsProvider } from './providers/googlemaps';
import { itemsProvider } from './providers/items';
import { snowflakeProvider } from './providers/snowflake';
import { stripeProvider } from './providers/stripe';
import { createRegistry, setBuiltinRegistry } from './registry';
import type { ProviderAdapter } from './types';

export const builtinProviders: readonly ProviderAdapter[] = [
  accountsProvider,
  elevenlabsProvider,
  googlemapsProvider,
  itemsProvider,
  snowflakeProvider,
  stripeProvider,
];

setBuiltinRegistry(createRegistry(builtinProviders));
