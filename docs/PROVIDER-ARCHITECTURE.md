# Provider-agnostic architecture

Isotope core is provider-agnostic. Provider integrations translate provider-specific package identities, fixtures, SDK boundaries, and provenance metadata into canonical Isotope contracts. All downstream detection, semantic reasoning, repair, verification, and reporting operate on those contracts.

## What is generic

- L1 dependency selection against ChangeSpec ecosystems
- L2 taint/BDG propagation
- L3 process isolation, determinism, serialization, egress blocking
- L4 structural differ and L6 verdicts
- L5 evidence packets (provider appears as data)
- Repair eligibility, verification, reporter templates

## What is provider-owned

Registered adapters in `@isotope/providers`:

- dependency matchers
- boundary stubs (`createStub`)
- fixture versioning
- envelope prefixes
- request headers for incoming webhooks

## What is application-owned

`isotope.yml` entry points, local `recordAll` mocks, reasoner/repair flags.

## What is fixture/test-owned

Synthetic corpus pairs (`meta.synthetic: true`), historical Stripe Basil cases, and synthetic Snowflake `execute()` rows. Those are tests, not a privileged core.

Built-in adapters are statically registered. There is no remote plugin loader.
