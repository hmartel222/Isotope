# Harness boundary

The portable core receives only a ChangeSpec registry, normalized fixture registry, customer `isotope.yml`, customer repository plus base/head refs, and explicit flags/secrets. Provider names, event names, payload roots, signature headers, fixture paths, and SDK call shapes belong to packs or customer configuration—not `packages/*/src`.

`tests/boundary.test.cjs` enforces this mechanically with no allow-list. `tests/api-agnostic.test.cjs` drives an invented provider through selection and execution and proves no-match produces `SKIP`.

Targets must keep the affected access in the configured handler or one directly imported/local helper. A path hidden by `try`/`catch`, more than one local-function hop, or a re-export may exceed the intentionally bounded resolver and become `INDETERMINATE`. Keep I/O-touching imports at four or fewer.

Stripe-specific target-shape note (pack evidence, not core knowledge): old API versions still render `items.data[*].current_period_end`, and `subscription.current_period_end` equals `items.data[0].current_period_end`. A naive `[0]` migration and a bare `Math.max` over items both PASS mechanically. Observable semantic change for the aggregating/ambiguity cases requires a fallback from the removed top-level field to the item-level policy.

Provider packs own their evidence. Product fixtures must be captured from the provider, normalized only with the repository normalizer, verified, and secret-scanned. Synthetic fixtures are permitted only for internal plumbing tests and must declare `synthetic: true`.
