import Payjp from 'payjp';
import { db } from './db';
const payjp = new Payjp('inert');
throw new Error('wrong-provider case must never execute');
export function handler() {
  const event = payjp.webhooks.constructEvent('', '', '');
  db.subscription.update({ data: { renewalDate: event.data.object.current_period_end } });
}
