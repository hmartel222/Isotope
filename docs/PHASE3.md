# Phase 3 audit and acceptance

## Baseline before edits

Inspected workspace configuration, core contracts/artifact helpers, CLI/config/static BDG, fixture loading, harness worker, serializer, differ/behavioral view, and generated signatures. Phase 2 already used one fresh Node/Vitest process per run. It assumed exactly one Express entry, one Stripe strategy, one `db` export, and hardcoded `db.subscription.update`. Network protection existed only within the worker. Time/random/UUID were not frozen; cycles/functions/Buffers were unsupported.

Node 20.20.2 / pnpm 9.15.9: install, typecheck, 130 tests, and build passed before refactoring. Inspected baseline signatures: both payloads return HTTP 200; the broken synthetic pair changes `/calls/0/args/0/data/renewalDate` from `1700000123` to `__undefined__`; determinism passes, mechanical critical `value_to_missing`, FAIL/exit 1. The identical-behavior control returns PASS/exit 0.

The real normalized Stripe pair remains absent. The supplied conversation itself described real-provider acceptance as blocked. No fixture was fabricated, captured, or substituted into the provider directory.

## Architecture after refactor

Only `harness-ts`, CLI plan translation, tests and documentation changed. Core schemas and behavioral comparison rules remain unchanged. See [harness API and limitations](../packages/harness-ts/README.md).

The CLI now creates explicit plans. The parent generates one test under the target root, executes a fresh child with a network-blocking preload, validates its separate result and cleans transient files. Configured proxies record nested calls with canonical sink kinds and cloned deterministic returns. Stripe interception must be exercised. Express/plain adapters are independent of Vitest. Original/patched code versions, fixture pair/version/side and repository root stay explicit for later L10 reuse; repair itself is untouched.

Implementation choices relative to v3: preserve `express_route` naming and HTTP state in `returned`; freeze Date while allowing ordinary timers to settle; reject truncated evidence rather than compare deterministic truncation sentinels; BigInt/invalid-Date sentinels and aggregate limits are narrow defensive extensions. Keep Phase 2's conservative harness-failure INDETERMINATE/exit 4 mapping. Next/Lambda adapters are explicitly unsupported.

## Still static / deliberately deferred

ChangeSpec selection, the explicit CLI entry point, and walking-skeleton BDG remain static. There is no resolver, semantic model call, repair, Python execution, GitHub integration or fleet work in this phase.

Phase 4 should start in `packages/differ/src/index.ts`: its positional call comparison and structural subset currently handle identical behavior, value-to-missing, dropped calls, new-only throws and unstable runs. Complete v3 structural divergence classification and deterministic semantic-question routing, with branch-coverage tests. Do not add a semantic reasoner implicitly while filling out L4.

## Final validation

Node **20.20.2**, pnpm **9.15.9**:

- `pnpm typecheck`, `pnpm test` (**144 passing**), `pnpm build`, and `pnpm isotope --help` passed.
- The baseline `pnpm install --offline --frozen-lockfile` passed with the matching toolchain; no dependency or lockfile changes were needed.
- Real noisy TypeScript execution was equal across old0/old1/new0/new1: fixed Date, Math.random, Node named/default UUID and Web Crypto UUID, with other crypto still functional and parent credentials absent.
- Mutation/counter tests started fresh, preserved fixture/source bytes and call-time snapshots; each sequence began at zero.
- A local listener saw **zero connections** for fetch, HTTP, HTTPS, net and named HTTP imports. The test was run outside the desktop filesystem/network sandbox to allow the listener itself; the harness child retained its preload restrictions.
- Synchronous and unresolved-promise handlers timed out; recorded worker PIDs were gone, and generated files were cleaned. Crash, provider failure, serialization and malformed-result paths were exercised.
- Final `pnpm phase2:verify` synthetic control: **PASS / exit 0**. Synthetic broken pair: **FAIL / exit 1**, stable on both sides, HTTP 200 on all runs, critical mechanical `value_to_missing` at `/calls/0/args/0/data/renewalDate` (`1700000123` → `__undefined__`).
- All **nine saved CLI artifacts** were read and validated, including the four signatures; `.isotope/generated` was empty after completion. `git diff --check` passed.

Real-provider verification remains blocked by missing `fixtures/normalized/sub-updated-single/{old,new,meta}.json`. Product acceptance on real Stripe evidence is not claimed.
