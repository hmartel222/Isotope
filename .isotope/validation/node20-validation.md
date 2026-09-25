# Node 20 validation record

Date: 2026-09-22 (America/New_York)

- Repository base SHA: `1ecd7c7606a9589c1bdd70f1f97198fcce951ee8`
- Node: `v20.20.2`
- pnpm: `9.15.9`
- Working tree: uncommitted implementation; no commit or push performed

## Required gates

- `pnpm install --frozen-lockfile`: passed; all 16 workspace projects were current.
- `pnpm typecheck`: passed.
- `pnpm build`: passed; TypeScript project build, schema export, and Action bundle completed.
- `pnpm action:build`: passed.
- `pnpm test`: passed with loopback permission required by the egress-containment test. Result: 388 tests, 386 passed, 2 credential-gated live Gemini tests skipped, 0 failed; configured coverage was 100% for statements, branches, functions, and lines.
- `pnpm coverage:differ`: passed. Result: 70 tests passed; 100% statements, branches, and lines for the configured core/differ coverage scope (96.29% functions overall, with every per-file threshold above 90%).
- ChangeSpec compiler targeted tests: 17 passed, 0 failed.
- Reviewed Stripe and ElevenLabs source manifest hash validation: passed.

The TypeScript harness now records the Vitest worker PID, terminates that worker while its runner can reap it, and then terminates the detached runner group. The timeout-cleanup regression passed five isolated repetitions and the full concurrent suite.

## Credential-gated gates

`GEMINI_API_KEY`, `GOOGLE_API_KEY`, and `GOOGLE_GENERATIVE_AI_API_KEY` were absent. Both live compile commands fail closed with exit code 2 and `MODEL_UNAVAILABLE`; no model response, candidate, approval, or equivalence artifact was fabricated.

ElevenLabs also lacks a non-synthetic v2 product fixture pair. Its reviewed source manifest records that independent approval blocker.
