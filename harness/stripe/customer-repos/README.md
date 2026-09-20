# Built customer repositories

Standalone customer trees for the four public demo repos. Each contains only app code, `isotope.yml`, Dependabot, and the split Isotope workflows. No engine sources, specs, or fixtures.

Validated Action pin: `0bd2ea0f50bd17f0d1a527ce4f076b1e4a4d95b9` (`hmartel222/hophacksf26/action@0bd2ea0f50bd17f0d1a527ce4f076b1e4a4d95b9`). The deployment script replaces template pins with `ENGINE_SHA` before pushing.

| Directory | Target | Expected after a stripe 17.7.0 → 22.x Dependabot PR |
|---|---|---|
| `isotope-demo-mechanical` | `12-repair` | FAIL + verified deterministic repair |
| `isotope-demo-migrated` | `03-migrated` | PASS |
| `isotope-demo-aggregating` | `09-aggregating` | PASS_REASONED with Gemini; else ESCALATE |
| `isotope-demo-ambiguity` | `07-ambiguity` | ESCALATE, no patch |

Live Dependabot runs completed on 2026-09-20. Each verification uploaded `.isotope/` evidence and the trust-separated reporter published a marked PR comment. Run `harness/stripe/audit-customer-demos.sh` to validate the public evidence.
