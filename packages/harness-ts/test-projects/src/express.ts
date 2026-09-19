import Stripe from 'stripe';
import { db } from './db';
const stripe = new Stripe('inert-placeholder');
export function handler(req, res) {
  const event = stripe.webhooks.constructEvent(req.rawBody, req.headers['stripe-signature'], 'inert');
  db.user.create(event);
  return res.status(201).end('done');
}
export function json(req, res) {
  stripe.webhooks.constructEvent(req.body, '', '');
  const body = { value: 1 };
  res.status(202).json(body); body.value = 2;
}
export function send(req, res) { stripe.webhooks.constructEvent(req.body, '', ''); res.status(203).send('sent'); }
export function missing() { return 'no interception'; }
export async function retrieve(req, res) {
  stripe.webhooks.constructEvent(req.body, '', '');
  res.json(await stripe.subscriptions.retrieve('sub_test'));
}
