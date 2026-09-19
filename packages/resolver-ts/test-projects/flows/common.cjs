const Stripe = require('stripe');
const { db } = require('./db');
const stripe = new Stripe('inert');
exports.handler = function () {
  const event = stripe.webhooks.constructEvent('', '', '');
  const sub = event.data.object;
  const { current_period_end: renewal } = sub;
  db.subscription.update({ renewal });
};
