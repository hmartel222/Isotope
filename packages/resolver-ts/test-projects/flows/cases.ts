// Internal synthetic static-analysis corpus; never provider benchmark evidence.
import Stripe from 'stripe';
import * as SDK from 'stripe';
import { db as database } from './db';
import { client } from './client';
import { persist as importedPersist } from './helper';
import axios from 'axios';
const stripe = new Stripe('inert');
const namespaceClient = new SDK.Stripe('inert');

export async function direct() {
  const event = stripe.webhooks.constructEvent('', '', '');
  const subscription = event.data.object;
  database.subscription.update({ renewalDate: subscription.current_period_end });
}
export function typed(event: Stripe.Event) {
  database.subscription.update({ value: (event.data.object as any).current_period_end });
}
export function destructuring() {
  const event = stripe.webhooks.constructEvent('', '', '');
  const { data: { object: { current_period_end: renewal } } } = event;
  database.subscription.update({ renewal });
}
export async function bracket() {
  const sub = await stripe.subscriptions.retrieve('inert');
  const value = sub['current_period_end'];
  database.subscription.update({ value });
}
export function transform() {
  const event = stripe.webhooks.constructEvent('', '', '');
  const value = new Date(event.data.object.current_period_end * 1000);
  database.subscription.update({ value: `${String(value)}` });
}
export function aggregation() {
  const event = stripe.webhooks.constructEvent('', '', '');
  const periods = event.data.object.items.data.map(item => item.current_period_end);
  const renewal = Math.max(...periods);
  database.subscription.update({ renewal });
}
export function reduce() {
  const event = stripe.webhooks.constructEvent('', '', '');
  const renewal = event.data.object.items.data.reduce((maximum, item) => Math.max(maximum, item.current_period_end), 0);
  database.subscription.update({ renewal });
}
export function branch() {
  const event = stripe.webhooks.constructEvent('', '', '');
  if (event.data.object.current_period_end > 0) database.subscription.update({ fixed: 1 });
}
function persist(value) { database.subscription.update({ value }); }
function second(value) { persist(value); }
function recursive(value) { recursive(value); }
export function oneHop() { const event = stripe.webhooks.constructEvent('', '', ''); persist(event.data.object.current_period_end); }
export function importedHop() { const event = stripe.webhooks.constructEvent('', '', ''); importedPersist(event.data.object.current_period_end); }
export function twoHop() { const event = stripe.webhooks.constructEvent('', '', ''); second(event.data.object.current_period_end); }
export function recursion() { const event = stripe.webhooks.constructEvent('', '', ''); recursive(event.data.object.current_period_end); }
export function cast() { const event = stripe.webhooks.constructEvent('', '', ''); database.subscription.update({ value: (event.data.object as any).current_period_end }); }
export function cleared() {
  const event = stripe.webhooks.constructEvent('', '', '');
  let value = event.data.object.current_period_end;
  value = 123;
  database.subscription.update({ value });
}
export function reexport() { const event = client.webhooks.constructEvent('', '', ''); database.subscription.update({ value: event.data.object.current_period_end }); }
export function namespace() { const event = namespaceClient.webhooks.constructEvent('', '', ''); database.subscription.update({ value: event.data.object.current_period_end }); }
export function returned() { const event = stripe.webhooks.constructEvent('', '', ''); return event.data.object.current_period_end; }
export function multiple() { const event = stripe.webhooks.constructEvent('', '', ''); const value = event.data.object.current_period_end; console.info(value); database.subscription.update({ value }); return value; }
export function logging() { const event = stripe.webhooks.constructEvent('', '', ''); console.log(event.data.object.current_period_end); }
export function dynamic(key) { const event = stripe.webhooks.constructEvent('', '', ''); database.subscription.update({ value: event.data.object[key] }); }
export function indexed(index) { const event = stripe.webhooks.constructEvent('', '', ''); database.subscription.update({ value: event.data.object.items.data[index].current_period_end }); }
export function http() { const event = stripe.webhooks.constructEvent('', '', ''); const value = event.data.object.current_period_end; fetch('/local', { value }); axios.post('/local', { value }); }
export function shadow(stripe) { const event = stripe.webhooks.constructEvent('', '', ''); database.subscription.update({ value: event.data.object.current_period_end }); }
export function response(req, res) { const event = stripe.webhooks.constructEvent('', '', ''); return res.status(200).json({ value: event.data.object.current_period_end }); }
