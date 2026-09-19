import { Client } from '@isotope/test-items';
import { db } from './db';

const client = new Client();

/** Synthetic list() consumer. Not a production vendor evaluation. */
export async function handler() {
  const list = await client.items.list() as { items?: { id: string }[] };
  db.catalog.update({ data: { items: list.items } });
  return { ok: true };
}
