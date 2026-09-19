import Stripe from 'stripe';
import { db } from './db';
const stripe = new Stripe('inert');
export function handler(req: any, res: any) {
  const event = stripe.webhooks.constructEvent(req.rawBody, '', '');
  const object = event.data.object;
  const renewalDate = object.current_period_end
    ?? Math.max(...object.items.data.map((item: any) => item.current_period_end));
  db.subscription.update({ data: { renewalDate } });
  return res.status(200).json({ received: true });
}
