# HopHacks Fall 2026 — Isotope

Isotope traces upstream provider contract changes through application code, compares isolated old/new execution, and offers bounded repairs only after independent verification against the original behavior and a held-out fixture. It runs locally or inside the customer’s runner, with no hosted service or autonomous Git operations.

**Current status: Phase 1 contracts/scaffold only.** No provider analysis, handler execution, semantic reasoning, or repair is implemented. Product commands fail explicitly; help works.

The [Isotope v3 specification](docs-v3-spec.md) is the architectural source of truth. [Contract notes](docs/CONTRACTS.md) describe the frozen interfaces and Phase 1 decisions.

## Packages

- `core`: shared TypeBox schemas, inferred types, validators, artifact paths/I/O, stage interfaces, L6 stubs.
- `changespec`: L0/L1 registry seams and drafting/normalization stubs.
- `resolver-ts`, `resolver-py`: L2 resolver stubs.
- `harness-ts`, `harness-py`: L3 harness stubs.
- `differ`: L4 structural comparison stub.
- `reasoner`: L5 reasoning stub.
- `repair`: L7–L9 eligibility, deterministic candidate, planner, and application stubs.
- `verifier`: L10 repair verification stub.
- `reporter`: L11 reporting stub.
- `fleet`: L12 batch stub.
- `cli`: final command surface, argument parsing, and explicit unavailable-stage errors.

`py-runner/`, `action/`, `specs/`, `fixtures/`, and `corpus/` reserve later implementation locations. Product fixture directories contain no invented payloads. All synthetic examples are under `tests/fixtures/`.

## Setup

Use Node.js 20 and pnpm 9.15.9 (pinned in `package.json`). With nvm and Corepack installed:

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

`pnpm isotope` builds before running, so it works after a clean install. `pnpm test` builds, then runs offline Node test-runner tests. `pnpm typecheck` includes compile-time contract rejection tests. No credentials are required. This project rejects unsupported Node versions during install.

## Next milestone

Phase 2 starts at `packages/harness-ts/src/index.ts`: execute one hardcoded TypeScript handler against real old/new provider fixtures, twice each, and emit validated `Signature` artifacts through the core helpers. First prove repeatability, then connect one mechanical divergence and one unchanged case through `differ` and the CLI. Do not introduce the resolver, models, or repairs to unblock that walking skeleton.
