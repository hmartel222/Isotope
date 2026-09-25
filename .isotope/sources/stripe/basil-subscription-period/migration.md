# Stripe Basil subscription period migration

Reviewed snapshot of Stripe's Basil migration guidance for the 2025-03-31 API change.

Source: https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end
Retrieved: 2026-09-21

In the Basil API family, `current_period_start` and `current_period_end` are no longer subscription-level fields. Each subscription item contains its own `current_period_start` and `current_period_end` values instead. Code reading `subscription.current_period_end` must inspect `subscription.items.data[*].current_period_end`.

Because a subscription may contain multiple items with different billing periods, the replacement has many cardinality. Choosing a single item, the minimum, or the maximum requires an application policy; it is not a universally safe transformation.

For TypeScript projects, relevant Stripe-derived values may enter through `stripe.webhooks.constructEvent(...)`, `stripe.subscriptions.retrieve(...)`, or the `Stripe.Event` type. This reviewed snapshot describes evidence only and does not grant approval.
