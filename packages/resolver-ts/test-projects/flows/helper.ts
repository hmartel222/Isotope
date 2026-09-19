import { db } from './db';
export function persist(value: unknown) { db.subscription.update({ value }); return value; }
