# Paid-invoice contract break

Minimal webhook idiom for a shipped invoice handler: read the subscription id from the provider event and persist it. The old invoice payload exposes `invoice.subscription`; the new payload moves it to `invoice.parent.subscription_details.subscription`.

The entry point keeps the affected access directly in the handler so the resolver can attribute it.
