import { Client } from '@googlemaps/google-maps-services-js';
import { db } from './db';

const maps = new Client({});

/** Internal Places Legacy consumer that throws when result is absent. Not a live Google evaluation repository. */
export async function handler(event: { placeId: string }) {
  const response = await maps.placeDetails({ params: { place_id: event.placeId, key: 'inert' } }) as { data: { result: { formatted_address: string } } };
  db.venue.update({ data: { address: response.data.result.formatted_address } });
  return { ok: true };
}
