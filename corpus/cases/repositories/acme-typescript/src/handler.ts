import Acme from 'acme-events';
import { db } from './db';

const acme = new Acme('controlled');
export function handler(req: any, res: any) {
  if (req.headers['x-acme-signature'] !== 'controlled') throw new Error('custom provider header missing');
  const event = acme.events.decode(req.rawBody);
  db.jobs.save({ quota: event.legacy_quota });
  return res.status(204).send('ok');
}
