# HopHacks Fall 2026 — Isotope

Isotope traces provider contract changes through application code, compares isolated old/new execution, and ultimately offers bounded repairs only after independent verification against the original behavior and a held-out fixture. It runs in the customer’s runner, without a hosted service or autonomous Git operations.

The [v3 specification](docs-v3-spec.md) is the architectural source of truth. See [contract notes](docs/CONTRACTS.md) and the [Phase 2 specimen](examples/walking-skeleton/README.md).

## Implementation status

- Phase 1: monorepo, shared types/schemas, validation, artifact helpers, and package/CLI boundaries.
- Phase 2 implementation: real TypeScript handler execution, mocked Stripe/DB boundaries, side-effect capture, four independent runs, metadata-free determinism comparison, mechanical silent-break detection, and local CLI artifacts/verdicts.
- Phase 3: reusable TS child-process harness, config-driven nested mocks, exercised provider interception, fixed Date/random/UUID, bounded stable serialization, preload egress blocking, Express/plain adapters and repeat-run isolation. See [harness documentation](packages/harness-ts/README.md) and [Phase 3 audit](docs/PHASE3.md).
- Phase 4: complete pure structural differ, mechanical verdict precedence, informational PASS, semantic residual ESCALATE, scoped ambiguity hints and enforced ≥90% differ branch coverage. See the [Phase 4 audit](docs/PHASE4.md).
- Phase 5: real bounded TS/JS provider dataflow, deterministic BDGs, static-only `scan`, and generated-graph `verify`. See the [resolver documentation](packages/resolver-ts/README.md) and [Phase 5 audit](docs/PHASE5.md).
- Phase 6: local Git dependency detector and human-verified ChangeSpec selector for npm/PyPI, resolved lockfile preference, threshold crossing, deterministic `selected-specs.json`, and SKIP-without-L2 for irrelevant revisions. See the [Phase 6 audit](docs/PHASE6.md).
- Phase 7: reproducible five-case detection matrix with isolated Git histories and artifacts, covering mechanical FAIL, migrated PASS, provider no-op PASS, provenance-protected SKIP, and ambiguity ESCALATE. See the [Phase 7 audit](docs/PHASE7.md).
- Phase 8: bundled Node 20 GitHub Action, shared CLI/Action verification API, typed reporter, bounded annotations, bot-owned comment upsert, job summaries, and direct plus trust-separated workflow templates. See the [Phase 8 audit](docs/PHASE8.md).
- Phase 9: deterministic BDG-anchored repair candidates, isolated worktrees, immutable-baseline and held-out re-execution, structural anti-cheat checks, exit 5, and verified-repair reporting. See the [Phase 9 audit](docs/PHASE9.md).
- Phase 10: bounded L5 evidence packets, two independent semantic votes, `PASS_REASONED` / `FAIL_REASONED` / `ESCALATE`, and mechanical-failure bypass. See the [Phase 10 audit](docs/PHASE10.md).
- Phase 11: bounded L8 repair planner, ephemeral apply of model candidates, and independent L10 verification. See the [Phase 11 audit](docs/PHASE11.md).
- Phase 12: Python L2/L3 sidecar, remaining TS adapters, `language: auto`, offline ChangeSpec drafter, 16-case acceptance matrix, L12 fleet dashboard, and an honesty-bounded accuracy command. See the [Phase 12 audit](docs/PHASE12.md).
- **Real-provider acceptance is blocked:** `fixtures/normalized/sub-updated-single/{old,new,meta}.json` is absent. Passing synthetic integration tests proves the plumbing only.

Python requires a local `python3` interpreter. No hosted backend, auto-merge, or additional languages are in scope. Mechanical FAIL remains unappealable. Repairs are offered only after independent L10 verification.

## Package map

`core` owns schemas, artifact I/O, stage contracts and the L6 verdict resolver. `changespec` loads human-verified specs and emits `verified_by: draft` files that never enter L1. `resolver-ts` / `resolver-py` construct bounded provider dataflow graphs. `harness-ts` / `harness-py` execute isolated plans. `differ` owns pure structural classification. `reasoner` builds bounded evidence packets and two independent semantic votes. `repair` owns deterministic candidates plus the bounded L8 planner. `verifier` independently checks candidates. `reporter` renders PR comments. `fleet` renders a self-contained dashboard. `cli` orchestrates those packages. Core has no subsystem dependency.

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
pnpm isotope matrix
pnpm isotope matrix --group acceptance
pnpm isotope accuracy
pnpm isotope fleet --repos corpus/repos.json --out dist/dashboard.html
pnpm action:build
```

`pnpm typecheck` includes the specimen and compile-time contract rejection tests. `pnpm test` runs offline contract and end-to-end tests. No test requires credentials. Dependencies are installed separately; verification itself performs no provider network calls.

## Walking skeleton

```sh
pnpm isotope --config examples/walking-skeleton/isotope.yml scan
pnpm phase2:verify
```

`scan` writes a real BDG without fixtures or customer execution. `phase2:verify` invokes the normal verification CLI with the same config and generated graph. Verification requires the real normalized fixture pair and currently reports the missing-fixture blocker (exit 10). With the intended real pair supplied, the expected result is a mechanical **FAIL**, exit **1**: both handlers can return 200 while their attempted DB writes differ. There is no automatic capture or synthetic fallback.

The specimen README documents explicitly labeled synthetic broken/PASS control commands. Their fixture files live only under `packages/harness-ts/test-fixtures/` and are not real-world evaluation evidence.

## Next milestone

Phase 12 is frozen for this tree: do not weaken L1–L11, do not add a hosted service, auto-merge, new languages, or an open-ended repair agent. Remaining honest gaps are the absent real Stripe fixture pair and historical accuracy forks that are not present in this checkout.

`pnpm coverage:differ` runs the independent pure-differ suite and enforces the coverage gate; `pnpm test` also includes that gate.
