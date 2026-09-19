# Stripe acceptance-pack design

This pack implements the Stripe portion of v3 §9.1. The canonical product registry remains `specs/`; the copy in this pack makes the pack independently reviewable. Runtime code is always pointed at a registry and never knows this path.

Real evidence currently present and verified: `sub-updated-single` (planning) and `sub-updated-single-B` (held-out). The other four required pairs remain capture-gated; they must not be fabricated. `pack.yml` records that state and `capture/RUNBOOK.md` is the completion path.

| Case | Target | Fixtures / flags | Expected | Exit | Reporter | Defense |
|---|---|---|---|---:|---|---|
| 1 | `01-mechanical` flat removed-field read → DB | single, reasoner/repair off | FAIL mechanical | 1 | incompatibility | value becomes missing at DB sink |
| 2 | `02-partial` one migrated and one stale site | single | FAIL mechanical | 1 | incompatibility | stale write remains observable |
| 3 | `03-migrated` item read | single | PASS | 0 | clean | same single-item period |
| 4 | `04-migrated-item` second item idiom | single | PASS | 0 | clean | independent migrated syntax |
| 5 | `05-noop` | noop | PASS | 0 | clean | adjacent versions preserve behavior |
| 6 | `06-wrong-provider` | no fixture | SKIP, zero sites | 0 | clean | provenance, not field-name grep |
| 7 | `07-ambiguity` first-item policy | multi | ESCALATE, no patch | 3 | decision (c) | multiple valid item periods |
| 8 | out of scope | — | ElevenLabs/Python not built here | — | — | Stripe-only session |
| 9 | `09-aggregating` max item period | aggregating, reasoner on | PASS_REASONED | 0 | clean + reasoning | changed value follows explicit max policy |
| 10 | `10-injection` | single, adversarial comment | FAIL unchanged | 1 | incompatibility | model cannot clear mechanical failure |
| 11 | `11-no-reasoner` | aggregating, `--no-reasoner` | ESCALATE | 3 | decision (c) | safe degradation |
| 12 | `12-repair` | single + held-out, repair on | verified deterministic repair | 5 | repair (a) | baseline restored on unseen pair |
| 13 | `13-coordinated` one-hop helper | multi/aggregating + held-out | verified reasoned repair | 5 | repair (b) | bounded coordinated edit |
| 14 | `14-no-policy-repair` | multi, repair on | ESCALATE, no patch | 3 | decision (c) | declared business policy gate |
| 15 | recorded hardcoded candidate | single + held-out | overfit_rejected | 3 | rejected (d) | unseen timestamps defeat memorization |
| 16 | cases 12 and 13, model unavailable | deterministic verifies; reasoned manual | 5 / 3 | (a)/(c) | no speculative fallback |
| extra | `01-mechanical` with direct `@ts-ignore` | single | compiles, then FAIL | 1 | incompatibility | compilation is not behavior |
| extra | invoice handler | invoice-paid | FAIL | 1 | incompatibility | second documented contract break |

The target shapes are minimal reproductions of the shipped idioms named by v3 §1.6: `pascalbell/FFSD-backend` (direct reads), `Goodheart-Labs/viewpoints.xyz` (partial migration), `sanidhyy/genius-ai` and `NitroRCr/nyaai` (item-level migrations). Each target remains intentionally thin and resolver-attributable.
