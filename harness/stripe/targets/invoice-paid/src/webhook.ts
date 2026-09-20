import Stripe from 'stripe';
import { db } from './db';
const stripe = new Stripe('inert');
export function handler(req: any, res: any) {
  const event = stripe.webhooks.constructEvent(req.rawBody, '', '');
  db.invoice.update({ data: { subscriptionId: event.data.object.subscription } });
  return res.status(200).json({ received: true });
}
