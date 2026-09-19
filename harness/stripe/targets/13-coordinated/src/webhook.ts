import Stripe from 'stripe';
import { db } from './db';
import { hasLegacyPeriod, periodEnd } from './period';
const stripe = new Stripe('inert');
export function handler(req: any, res: any) {
  const event = stripe.webhooks.constructEvent(req.rawBody, '', '');
  const object = event.data.object;
  const item = object.items.data[0];
  const observed = item.current_period_end;
  db.subscription.update({ data: { renewalDate: hasLegacyPeriod(object) ? observed : periodEnd(item) } });
  return res.status(200).json({ received: true });
}
