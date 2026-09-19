# HopHacks Fall 2026 — Isotope

Isotope traces provider contract changes through application code, compares isolated old/new execution, and ultimately offers bounded repairs only after independent verification against the original behavior and a held-out fixture. It runs in the customer’s runner, without a hosted service or autonomous Git operations.

The [v3 specification](docs-v3-spec.md) is the architectural source of truth. See [contract notes](docs/CONTRACTS.md) and the [Phase 2 specimen](examples/walking-skeleton/README.md).

## Implementation status

- Phase 1: monorepo, shared types/schemas, validation, artifact helpers, and package/CLI boundaries.
- Phase 2 implementation: real TypeScript handler execution, mocked Stripe/DB boundaries, side-effect capture, four independent runs, metadata-free determinism comparison, mechanical silent-break detection, and local CLI artifacts/verdicts.
- Phase 3: reusable TS child-process harness, config-driven nested mocks, exercised provider interception, fixed Date/random/UUID, bounded stable serialization, preload egress blocking, Express/plain adapters and repeat-run isolation. See [harness documentation](packages/harness-ts/README.md) and [Phase 3 audit](docs/PHASE3.md).
- Phase 4: complete pure structural differ, mechanical verdict precedence, informational PASS, semantic residual ESCALATE, scoped ambiguity hints and enforced ≥90% differ branch coverage. See the [Phase 4 audit](docs/PHASE4.md).
- **Real-provider acceptance is blocked:** `fixtures/normalized/sub-updated-single/{old,new,meta}.json` is absent. Passing synthetic integration tests proves the plumbing only.

Not yet implemented: dependency-based ChangeSpec selection, AST/BDG generation, additional framework adapters, semantic reasoning, repair, Python execution, GitHub Action/reporting, fleet, or accuracy benchmarks.

## Package map

`core` owns schemas, artifact I/O, stage contracts and the mechanical verdict subset. `changespec` explicitly loads the known spec. `harness-ts` executes explicit plans using generated Vitest tests in fresh children. `differ` owns pure structural classification and behavioral comparison. `cli` orchestrates those packages. The other v3 packages (`resolver-ts`, `resolver-py`, `harness-py`, `reasoner`, `repair`, `verifier`, `reporter`, `fleet`) remain stubs. Core has no subsystem dependency; only the CLI orchestrates peers.

## Local setup

Use Node.js **20.19 or newer within Node 20**, and pnpm **9.15.9**. With nvm and Corepack available:

```sh
nvm use
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm isotope --help
```

`pnpm typecheck` includes the specimen and compile-time contract rejection tests. `pnpm test` runs offline contract and end-to-end tests. No test requires credentials. Dependencies are installed separately; verification itself performs no provider network calls.

## Walking skeleton

```sh
pnpm phase2:verify
```

This invokes the normal CLI with `examples/walking-skeleton/isotope.yml`. It requires the real normalized fixture pair and currently reports the missing-fixture blocker (exit 10). With the intended real pair supplied, the expected result is a mechanical **FAIL**, exit **1**: both handlers can return 200 while their attempted DB writes differ. There is no automatic capture or synthetic fallback.

The specimen README documents explicitly labeled synthetic broken/PASS control commands. Their fixture files live only under `packages/harness-ts/test-fixtures/` and are not real-world evaluation evidence.

## Next milestone

Phase 5: replace the static TypeScript BDG/provenance assumptions with the real AST resolver in `packages/resolver-ts`. ChangeSpec selection and entry-point scope remain explicit; semantic reasoning, repair and other deferred stages have not begun.

`pnpm coverage:differ` runs the independent pure-differ suite and enforces the coverage gate; `pnpm test` also includes that gate.
