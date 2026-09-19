import Stripe from 'stripe';
import { db } from './db';
const stripe = new Stripe('inert');
export function handler(req: any, res: any) {
  const event = stripe.webhooks.constructEvent(req.rawBody, '', '');
  const renewalDate = Math.max(...event.data.object.items.data.map((item: any) => item.current_period_end));
  db.subscription.update({ data: { renewalDate } });
  return res.status(200).json({ received: true });
}
