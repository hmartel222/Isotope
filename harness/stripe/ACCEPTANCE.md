# Stripe harness acceptance

Evidence recorded 2026-09-19 against engine `6e69db76b94f7314496cbcbda0f9565cf8de9ba1` (Action registry fix `101e9c7432976e8ea29fa7119b6176be06a04d28`). Commands used Node 20.20.2 and pnpm 9.15.9. Nothing here is a fabricated verdict: each Actual cell quotes an exit code or GitHub Actions log.

## Engine suite

| Check | Evidence |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm test` | 348 pass, 0 fail, 2 skipped, exit 0 |
| `pnpm isotope matrix --group all` | **18/18 required cases matched**, exit 0 |
| `node tools/normalize-fixtures.js --verify` | 6/6 pairs OK: `sub-updated-single`, `sub-updated-single-B`, `sub-updated-multi`, `sub-updated-aggregating`, `sub-updated-noop`, `invoice-paid` |
| secret scan `git grep --no-index -nE '(sk\|rk\|pk)_(live\|test)_\|whsec_\|ghp_' -- fixtures/` | no matches |
| Action topology test `Action uses bundled registries when the customer repo has no specs or fixtures` | pass; empty `INPUT_SPECS-PATH` + customer `dependabot.yml` still selected `stripe.basil.subscription-period` and FAILed mechanically |

## Product-path CLI (real fixtures, harness targets)

Walking-skeleton `pnpm isotope --config harness/stripe/targets/<id>/isotope.yml verify …` unless noted.

| Case | Expected | Actual | Exit | Evidence |
|---|---|---|---:|---|
| 1 `01-mechanical` | FAIL mechanical | FAIL `mechanical_incompatibility` | 1 | `ChangeSpec: stripe.basil.subscription-period`; `Fixture pair: sub-updated-single`; `db_write` `value_to_missing` |
| 2 `02-partial` | FAIL | FAIL `mechanical_incompatibility` | 1 | same fixture; stale site remains |
| 3 `03-migrated` | PASS | PASS `identical_behavior` | 0 | item-level read |
| 4 `04-migrated-item` | PASS | PASS `identical_behavior` | 0 | second item idiom |
| 5 `05-noop` | PASS | PASS `identical_behavior` | 0 | `Fixture pair: sub-updated-noop` |
| 6 `06-wrong-provider` | SKIP, zero sites | matrix `wrong-provider-skip` SKIP | 0 | engine matrix row, not a Stripe Dependabot PR |
| 7 `07-ambiguity` | ESCALATE, no patch | ESCALATE `semantic_reasoner_unavailable` | 3 | `Fixture pair: sub-updated-multi`; repair disabled |
| 8 ElevenLabs | out of scope | matrix `python-elevenlabs` FAIL | 1 | kept in engine matrix only |
| 9 `09-aggregating` | PASS_REASONED | **degraded ESCALATE** | 3 | live Gemini returned HTTP 503 twice (`gemini-3.6-flash`); spec §2.4. Offline matrix `reasoned-pass` is PASS_REASONED via cassette |
| 10 `10-injection` | FAIL unchanged | FAIL `mechanical_incompatibility` | 1 | mechanical FAIL is unappealable |
| 11 `11-no-reasoner` | ESCALATE | ESCALATE `semantic_reasoner_unavailable` | 3 | `Fixture pair: sub-updated-aggregating` |
| 12 `12-repair` | FAIL → verified repair, exit 5 | FAIL + **VERIFIED repair**, exit **5** | 5 | standalone customer repo (src at repo root). `Repair: VERIFIED (offered only; checkout unchanged)`; held-out verification `verdict: PASS`; `reason: Independently verified against planning and held-out provider contracts`. Nested monorepo run rejected `patch_invalid` because the ephemeral worktree is the engine root — production topology is the customer repo |
| 13 `13-coordinated` | FAIL_REASONED → verified reasoned repair | matrix `reasoned-verified-repair` FAIL_REASONED | matrix | live planner needs Gemini; 503 blocked a live run. Offline matrix matched |
| 14 `14-no-policy-repair` | ESCALATE, no patch | ESCALATE; `Repair: not eligible for this verdict` | 3 | business-policy / semantic residual, no patch |
| 15 overfit | `overfit_rejected` | matrix `overfit-rejected` matched | matrix | recorded adversarial candidate; verifier rejects |
| 16 model unavailable | deterministic still verifies; reasoned → manual | matrix `planner-unavailable` matched | matrix | plus case 12 standalone (deterministic, no model) |
| silent-compile | `tsc --noEmit` 0, then FAIL | tsc exit 0; verify FAIL | 0 then 1 | `npx tsc --noEmit -p harness/stripe/targets/silent-compile/tsconfig.json` |
| invoice-paid | FAIL | FAIL `mechanical_incompatibility` | 1 | `Fixture pair: invoice-paid` |

Case 12 standalone quote:

```
Dependency changes:
  stripe 17.7.0 → 18.1.0 (npm)
Selected ChangeSpecs:
  stripe.basil.subscription-period
…
db_write /calls/0/args/0/data/renewalDate
  old: 1792395112
  new: undefined
  value_to_missing / mechanical / critical
Verdict: FAIL
Repair: VERIFIED (offered only; checkout unchanged)
```

Exit code 5. Held-out fixture: PASS.

## Live customer CI

Four public repos already exist with real Dependabot PRs (`stripe` 17.7.0 → 22.6.2), split workflows, and `contents: read` only:

| Repo | Dependabot PR |
|---|---|
| [isotope-demo-mechanical](https://github.com/hmartel222/isotope-demo-mechanical) | https://github.com/hmartel222/isotope-demo-mechanical/pull/1 |
| [isotope-demo-migrated](https://github.com/hmartel222/isotope-demo-migrated) | https://github.com/hmartel222/isotope-demo-migrated/pull/1 |
| [isotope-demo-aggregating](https://github.com/hmartel222/isotope-demo-aggregating) | https://github.com/hmartel222/isotope-demo-aggregating/pull/1 |
| [isotope-demo-ambiguity](https://github.com/hmartel222/isotope-demo-ambiguity) | https://github.com/hmartel222/isotope-demo-ambiguity/pull/1 |

First runs (Action `@9f2ca965d957122b57a783a38f8767b20045e74b`) failed before any behavioral verdict. GitHub Actions log:

```
ArtifactValidationError: Invalid ChangeSpec: / must have required property 'id' …
/ must NOT have additional properties {"additionalProperty":"version"}
/ must NOT have additional properties {"additionalProperty":"updates"}
```

That YAML is `.github/dependabot.yml`. GitHub sets unused Action inputs to `""`, so the bundled-registry fallback never applied and `verify` scanned the customer checkout. The Action now treats blank inputs as missing and loads `action/registry/{specs,fixtures}`. Covered by `tests/phase8-action.test.cjs`.

Re-pinning and re-running those PRs requires push access to the demo repos. This agent token can write `hmartel222/hophacksf26` only (`permissions.push: false` on the demos). From a machine that can push them:

```bash
cd hophacksf26
git checkout cursor/stripe-harness-18eb
./harness/stripe/push-customer-demos.sh
```

Then set `GEMINI_API_KEY` as both an Actions secret and a Dependabot secret on `isotope-demo-aggregating` if you want live case 9 (`PASS_REASONED`) instead of degraded `ESCALATE`.

Expected after re-pin (repair on for mechanical; reasoner on for aggregating):

| Demo | Expected verdict | Exit | Comment variant |
|---|---|---:|---|
| mechanical | FAIL + verified deterministic repair | 5 | §3.12 (a) |
| migrated | PASS | 0 | clean |
| aggregating | PASS_REASONED with key; else ESCALATE | 0 / 3 | reasoned-pass or (c) |
| ambiguity | ESCALATE, no patch | 3 | §3.12 (c) |

## Empirical fixture constraint (do not design around it incorrectly)

On the captured multi-item pairs, old `subscription.current_period_end` equals `items.data[0].current_period_end`, and item-level periods exist on **both** API versions (`1792450717` vs `1821394717` for aggregating). A naive `[0]` migration and a bare `Math.max` both PASS honestly. Cases 7/9/11/14 use a fallback from the removed top-level field to `Math.max`.
