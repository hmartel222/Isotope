import Stripe from 'stripe';
import { db } from './db';
const stripe = new Stripe('inert');
export function handler(req: any, res: any) {
  const event = stripe.webhooks.constructEvent(req.rawBody, '', '');
  db.subscription.update({ data: { renewalDate: event.data.object.items.data[0].current_period_end } });
  return res.status(200).json({ received: true });
}
