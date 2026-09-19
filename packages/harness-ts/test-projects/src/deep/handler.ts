import { db } from '../db';
export function handler(event) { db.user.create(event); return event; }
