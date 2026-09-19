import Stripe from 'stripe';
import { db } from './db';
const stripe = new Stripe('inert');
export function handler(req: any, res: any) {
  const event = stripe.webhooks.constructEvent(req.rawBody, '', '');
  const itemPeriod = event.data.object.items.data[0].current_period_end;
  db.subscription.update({ data: { renewalDate: itemPeriod } });
  return res.status(200).json({ received: true });
}
