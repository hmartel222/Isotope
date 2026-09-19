# Internal Phase 2 execution specimen

**Not part of the real-world evaluation corpus.** This small handler intentionally reads the old subscription-level period field. No repair is applied.

Static pieces: one explicitly chosen ChangeSpec, one configured entry point, and `bdg.stub.json`. The BDG’s provenance describes a known provider call but was authored manually, not discovered by an AST resolver.

Real pieces: Vitest imports and executes the TypeScript handler in four fresh child processes; Stripe `constructEvent` and `db.subscription.update` are mocked before import; the provider stub must be invoked; returned HTTP state, exceptions, and ordered DB arguments are captured. Each fixture starts fresh. Comparison uses only returned/threw/calls, preserving all metadata in the stored signatures.

## Provider run

From the repository root, after setup:

```sh
pnpm phase2:verify
```

Equivalent:

```sh
pnpm isotope --config examples/walking-skeleton/isotope.yml verify --no-reasoner --no-repair
```

The command reads `specs/stripe/basil-subscription-period.yaml` and requires:

```text
fixtures/normalized/sub-updated-single/old.json
fixtures/normalized/sub-updated-single/new.json
fixtures/normalized/sub-updated-single/meta.json
```

These files are currently absent. No real-provider acceptance has been claimed. Fixtures are never captured, normalized, edited, or substituted automatically. `meta.json` must be an object; event envelopes provide `api_version`, `type`, and subscription identity. Shape checks do not certify provider provenance; that remains the fixture capture/normalization chain’s responsibility. A synthetic marker is rejected in the product path.

## Synthetic software controls only

From the repository root:

```sh
ISOTOPE_TEST_FIXTURES="$PWD/packages/harness-ts/test-fixtures/control" pnpm phase2:verify
# Expected: PASS, exit 0. Same application behavior on both sides.

ISOTOPE_TEST_FIXTURES="$PWD/packages/harness-ts/test-fixtures/broken" pnpm phase2:verify
# Expected: FAIL, exit 1. Hand-authored plumbing data, NOT Stripe evidence.
```

`ISOTOPE_TEST_FIXTURES` is an internal test hook, not provider selection. It requires `meta.synthetic: true`, visibly labels output synthetic, and uses a `synthetic-` fixture-pair ID in every signature path. It never defaults on. Test runs use temporary specimen/artifact directories; these manual commands write this specimen’s ignored `.isotope/` directory.

## Inspect artifacts

Under `examples/walking-skeleton/.isotope/`:

- `selected-specs.json`, `bdg.json`.
- Four `signatures/original/<pair>/ep_phase2.<encoded-api-version>.<0-or-1>.json` files.
- `diff-report.json`, `verdict.json`, `isotope-report.json`.

The report references signatures and diffs containing fixture versions, return values, determinism status, and observed DB values. Paths are constructed by core; each artifact is validated on write. There are no fabricated reasoning/repair artifacts or empty later-stage directories. Failed harness reruns clear this invocation’s old signatures/diff and write an INDETERMINATE report without invented execution evidence.

## Boundaries

Only the Express-like status/json/send adapter, Stripe constructEvent, and one configured `db` export with `subscription.update` are supported. DB module paths resolve from the config directory. The specimen’s actual DB module throws if it is ever reached: there is no connection or database client. Fetch, HTTP(S) request/get, and socket connection attempts are blocked inside the worker; even a caught blocked request invalidates the run. This is not yet the full v3 egress sandbox or a sandbox for arbitrary untrusted repositories.

PASS → 0; mechanical FAIL → 1; unstable/untrustworthy/unsupported semantic comparison → INDETERMINATE → 4; invalid config or missing fixtures → 10. Other CLI commands remain explicit stubs. Full v3 semantic escalation is deferred; Phase 2 never emits a fabricated reasoned verdict.
