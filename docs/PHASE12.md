# Phase 12 — Python, adapters, drafter, matrix, fleet, accuracy

Phase 12 generalizes the walking skeleton without weakening L1–L11. Python L2/L3 reuse the same BDG, Signature, DiffReport, and verdict contracts. ElevenLabs is a second **detection** provider; it has no safe repair codemod.

## Language routing

`language: auto` sends `*.py` entry points to `@isotope/resolver-py` / `@isotope/harness-py` and everything else to the TypeScript stack. Mixed Python and TypeScript entry points in one config are rejected. The sidecar is `python3 py-runner/isotope_runner/cli.py` over JSON stdin/stdout.

## Adapters

TypeScript now implements `plain`, `express_route`, `next_app_route`, `next_pages_api`, and `lambda`.

## ChangeSpecs

`removed_symbol` and `codemod.kind: unsupported` are additive. `verified_by: draft` drafts can be listed/validated but never enter L1 `SelectedSpecs`. `isotope spec draft` writes under `.isotope/drafts/`.

## Matrix

`isotope matrix` remains the five-case detection group. `isotope matrix --group acceptance` runs the sixteen canonical cases, including Python/ElevenLabs, cassette reasoner/planner paths, verified repair (exit 5), overfit rejection, and planner-unavailable.

## Fleet and accuracy

`isotope fleet` emits a self-contained `dashboard.html` (inline CSS/JS, no CDN). `isotope accuracy` reports `N_run` and `N_blocked_historical` explicitly. Named historical forks are blocked unless their commits exist locally.

## Freeze

No hosted backend, auto-merge, additional languages, or open-ended repair agent. Mechanical FAIL is still unappealable. `VerifiedRepair` remains `offeredOnly`.
