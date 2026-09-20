# Built customer repositories

Standalone customer trees for the four public demo repos. Each contains only app code, `isotope.yml`, Dependabot, and the split Isotope workflows. No engine sources, specs, or fixtures.

Action pin: `800e81cf50f2fa4390af0f9c1ecde7eef5d57d15` (`hmartel222/hophacksf26/action@800e81cf50f2fa4390af0f9c1ecde7eef5d57d15`).

| Directory | Target | Expected after a stripe 17.7.0 → 22.x Dependabot PR |
|---|---|---|
| `isotope-demo-mechanical` | `12-repair` | FAIL + verified deterministic repair |
| `isotope-demo-migrated` | `03-migrated` | PASS |
| `isotope-demo-aggregating` | `09-aggregating` | PASS_REASONED with Gemini; else ESCALATE |
| `isotope-demo-ambiguity` | `07-ambiguity` | ESCALATE, no patch |

Live Dependabot runs are left for a follow-up agent with push access to `hmartel222/isotope-demo-*`.
