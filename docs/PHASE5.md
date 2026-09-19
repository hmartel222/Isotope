# Phase 5 — bounded TypeScript/JavaScript resolver

Phase 5 replaces normal verification's hand-authored BDG with real static analysis. `isotope scan` now generates the same canonical graph without loading fixtures or executing customer code. L3 isolation, L4 classification and L6 mechanical authority remain intact. No semantic reasoner, repair, Python resolver or automatic ChangeSpec selection was added.

## Repository audit

The Phase 5 baseline was clean `main` at `f902fc8`, with 227 tests passing, typecheck/build passing, and synthetic PASS, mechanical FAIL and semantic ESCALATE controls working. The interrupted implementation was resumed in place, preserving its uncommitted changes. Final review corrected inferred-type provenance bypassing the re-export bound, confidence propagation through constructed objects, helper lexical scope, conditional assignment joins, and reporting a call cutoff reached before discovering a root. Phase 5 changes remain uncommitted.

## Implementation

`@isotope/resolver-ts` exposes `resolveBehavioralDependencyGraph({ repositoryRoot, entryPoints, changeSpec, config })`, retaining compatibility with the existing core resolver input. It uses ts-morph and the TypeScript checker, actual tsconfig options/path aliases, and a narrow Babel JavaScript fallback feeding the same analysis engine. It never emits or executes customer code.

Provider packages and root patterns come from ChangeSpec detection configuration, without provider-name branches. Proven imports/require, constructors, aliases, one client re-export and provider-declared explicit type annotations establish provenance. Direct call/type roots are high confidence; a helper parameter or re-export is medium; heuristics and indeterminate dynamic keys are low. Confidence never increases downstream. PAY.JP or a field name alone cannot prove Stripe provenance.

An explicit statement worklist tracks facts, environments and visited state. Supported constructs include bindings, nested destructuring, dot/bracket/index access, await, casts, sequential reassignment clearing, arithmetic, Date/conversion/template transforms, map/reduce/sort and Math min/max aggregation, branches and one local helper hop. Helper calls retain lexical scope and distinct call contexts. Branches record control dependence without tainting unrelated constants. Recursive calls terminate at the same bound.

Paths are parsed segments with array wildcards. Conventional `data.object` envelopes normalize away; removed and replacement paths both remain represented. Unknown object keys are indeterminate rather than guessed. Aggregation and cast suppression survive serialization.

Configured mocks determine canonical sink identities compatible with L3, including aliased imports. All six existing sink categories are supported; recognized additional boundaries include entry returns, Express responses, console/common logger calls, unshadowed fetch and imported axios. Provider SDK calls are not automatically outbound customer sinks.

Graphs use existing `taint_root`, `binding`, `transform`, `branch`, `local_call`, `sink` nodes and `flows_to` edges. Canonical affected sites retain change/path/provenance evidence and reachable sinks. IDs hash stable relative source locations, kind, operation, path and call context; output collections are sorted. Locations include start line/column and end line. **No contract/schema changes** were required; the existing location schema has no end column.

## CLI and evidence hierarchy

`scan` loads configuration and the explicit ChangeSpec, validates/writes `.isotope/bdg.json`, and summarizes roots, sites, confidence, transforms, sinks and diagnostics. `verify` consumes that generated graph before the existing harness/differ/verdict pipeline. `bdg.stub.json` is only historical test evidence.

No proven root means SKIP without customer execution. If an analysis bound prevents a complete no-root conclusion, verification returns INDETERMINATE/exit 4. A proven runtime mechanical loss still FAILs even when static call bounds prevent sink association. Multiple entries are sorted and receive separate artifacts plus an aggregate report. Semantic residuals remain ESCALATE/exit 3; no model participates.

## Final validation

Validation used Node **20.19.5** and pnpm **9.15.9** on this checkout:

| Check | Result |
| --- | --- |
| `pnpm typecheck` | PASS |
| `pnpm test` | **282 passed**, zero failures/skips; includes 48 resolver and 8 Phase 5 integration tests |
| `pnpm build` | PASS |
| Configured differ/verdict coverage gate | 100% statements, branches, functions and lines in the scoped L4/L6 files; not resolver or repository-wide coverage |
| `pnpm isotope --help` | PASS |
| Walking-skeleton `scan` | One provider root, one high-confidence affected site, reachable `db.subscription.update` / `db_write` |
| Standalone synthetic identical control | PASS, exit 0; stable signatures, empty diff |
| Standalone synthetic broken pair | FAIL, exit 1; stable signatures and exact generated sink association |
| Aggregation integration | `aggregation: true`; runtime 100 → 200, semantic `value_changed`, ESCALATE/exit 3 |
| Wrong-provider integration | Zero authoritative Stripe sites; SKIP/no_taint_root, no execution |
| One-hop/cutoff tests | One hop propagates at medium; recursion/two hops terminate with diagnostics |
| Cutoff before root | INDETERMINATE/exit 4, no execution |
| Runtime loss beyond static cutoff | Mechanical FAIL/exit 1 with null `bdgNodeId` |
| Existing Phase 4 regressions | PASS, including instability/INDETERMINATE and informational additions/PASS |

The broken-case divergence is `/calls/0/args/0/data/renewalDate`: `1700000123` → `__undefined__`, `value_to_missing`, mechanical/critical, `db_write`. Its `bdgNodeId` references a generated sink reachable from the high-confidence affected site.

Generated BDGs, reports, diffs, verdicts and referenced signatures were read through canonical runtime validators, including standalone controls. Standalone snapshots are local ignored artifacts under `.isotope/phase5-validation/{control,broken}`. Dedicated tests also verify determinism, no source mutation, ignores, the 200-file cap, conservative confidence, provider-neutral configuration and JavaScript fallback.

## Bounds and remaining seams

Customer-source admission is capped at 200 files and excludes dependency/build/artifact directories and configured ignores. Analysis permits one local-function hop, one provider-client re-export hop and 30,000 expression operations per entry. Omissions and unsupported operations produce canonical `BDG.skipped` diagnostics. Loops use a diagnosed single-pass join, not full convergence. Arbitrary dynamic dispatch, general callbacks, class/method analysis, heap/property mutation, exception flow, deep module provenance and arbitrary pattern syntax are unsupported. Type roots require available provider declarations and explicit annotations. See the [resolver README](../packages/resolver-ts/README.md) for precise behavior.

ChangeSpec selection, configured entry points, mock boundaries and the existing fixture-selection seam remain explicit. No corpus benchmark was run. The real Stripe command was run and returned blocker exit 10: `fixtures/normalized/sub-updated-single/{old,new,meta}.json` remain absent. All runtime results above use clearly identified synthetic engineering fixtures; real-provider acceptance remains blocked and no provider payloads were fabricated.

The recommended Phase 6 starting point is bounded L5 semantic reasoning over validated residual divergences and causal BDG evidence, with replay tests and mechanical-failure precedence preserved. Phase 6 has not been started.
