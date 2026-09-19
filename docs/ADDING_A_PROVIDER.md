# Adding a provider

Isotope core is provider-agnostic. A provider integration translates package identity, fixtures, SDK boundaries, and provenance metadata into canonical contracts. Detection, reasoning, repair, verification, and reporting never branch on a vendor name.

## Minimum path

1. Choose a stable `id` (`stripe`, `googlemaps`, `isotope-accounts`).
2. Declare `dependencyMatchers` (`npm` / `pypi` package names).
3. Add human-verified ChangeSpecs under `specs/<id>/` with `provider: <id>`.
4. If the TS harness must intercept an SDK, implement a `BoundaryAdapter` (`module`, `namedExports`, `createStub`). Incoming webhooks may also set `requestHeaders`.
5. Optionally implement `fixture.version` and `ambiguityRoots` when payloads are not labeled in `meta.json`.
6. Optionally set `provenanceHints.envelopePrefix` (webhook `data.object`) and `preserveLiterals` for redaction.
7. Register the adapter in `packages/providers/src/builtins.ts` (static builtins only; no remote plugin loader). Optional `defaultUpgrade` supplies matrix versions when a case omits `dependency`.
8. Add a synthetic corpus case under `corpus/cases/` with `meta.synthetic: true`.
9. Run `node packages/cli/dist/bin.js matrix --case <id>` and `node --test tests/providers.test.cjs`.

Do not edit `packages/differ`, verdict resolution, the reasoner prompt architecture, or the harness child isolation machinery.

## Tiny example

See `packages/providers/src/providers/accounts.ts` (`client.accounts.retrieve()`) or `packages/providers/src/providers/snowflake.ts` (`snowflake-sdk` `execute()`). Both are **provider-interface** fixtures, not production evidence that Isotope “supports” those vendors.

## Capabilities

The registry rejects a lookup when the named provider is missing. It never falls back to Stripe. If two providers claim the same package, matching fails as ambiguous.
