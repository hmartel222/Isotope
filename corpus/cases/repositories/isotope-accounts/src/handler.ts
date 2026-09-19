import { Client } from '@isotope/test-accounts';
import { db } from './db';

const client = new Client();

/** Synthetic SDK retrieve consumer. Not a production vendor evaluation. */
export async function handler() {
  const account = await client.accounts.retrieve('acct_synthetic') as { renewal: unknown };
  db.billing.update({ data: { renewal: account.renewal } });
  return { ok: true };
}
