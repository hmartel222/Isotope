import Payjp from 'payjp';
import { db } from './db';
const stripe = new Payjp('inert');
export function handler() {
  const event = stripe.webhooks.constructEvent('', '', '');
  db.subscription.update({ value: event.data.object.current_period_end });
}
