# API-agnostic execution and detection

Isotope's generic pipeline is driven by `ChangeSpec` and `isotope.yml`; it does not choose a provider from the project language and it does not fall back to a specimen. Exactly one human-verified spec must match explicit dependency, import, or configured-module evidence.

Provider execution behavior is isolated behind adapters. `fixture-call` is the provider-neutral adapter: configuration declares module exports, fixture-returning call paths, optional request headers, and optional recorded boundaries. Specialized compatibility behavior lives only in provider adapter and fixture-validator modules. Adding a provider therefore requires data and an adapter only when its runtime shape cannot be described by `fixture-call`; generic selection, resolution, execution, diffing, reasoning, and reporting code should not change.

Every fixture pair contains `old.json`, `new.json`, and `meta.json`. Metadata declares `provenance`, distinct version labels (or inherits them from the selected spec), and `synthetic: true` for controlled test data. Product fixture directories reject synthetic fixtures.

The acceptance corpus includes two deliberately invented providers: Acme exercises TypeScript constructor interception and a custom header; Contoso exercises Python call interception and arbitrary ChangeSpec metavariables. The `api-agnostic` tests also enforce a static leakage guard over generic production paths.
