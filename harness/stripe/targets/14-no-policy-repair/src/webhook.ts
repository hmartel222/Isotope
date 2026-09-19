import Stripe from 'stripe';
import { db } from './db';
const stripe = new Stripe('inert');
export function handler(req: any, res: any) {
  const event = stripe.webhooks.constructEvent(req.rawBody, '', '');
  const items = event.data.object.items.data;
  const renewalDate = items[0].current_period_end;
  db.subscription.update({ data: { renewalDate } });
  return res.status(200).json({ received: true });
}
