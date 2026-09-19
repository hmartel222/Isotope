# Phase 6 audit

Phase 5 was intact before this change: bounded TypeScript/JavaScript resolver, generated BDG, real isolated harness, structural differ and mechanical/semantic verdict boundary. Baseline validation was 144 existing Phase 1–5 tests plus typecheck/build; the real provider fixture blocker remains unchanged.

Phase 6 adds a pure local Git L1 selector in `@isotope/changespec`. Git metadata and blob reads are separate from ecosystem parsers; normalized dependency transitions are separate from ChangeSpec matching. Resolved lockfile evidence wins over ranges; exact manifests are fallback evidence. Direct workspace package correlation prevents transitive lockfile churn from selecting a provider spec. npm and PyPI identity/version comparison is centralized, and threshold crossing is strict and directional.

`verify --base <ref> --head <ref>` now writes selected specs and either emits SKIP without running L2–L4 or feeds all human-verified matches into the existing analysis pipeline. No core artifact schema changed. The existing selected-spec artifact already stores full verified specs plus dependency transition fields. Git refs are explicit; no checkout/fetch/pull occurs.

Phase 6 tests create temporary Git histories and cover exact thresholds, package-lock, pnpm parsing, Python pins, source-only changes, unresolved ranges, deduplication, verification gating and malformed specs. The existing Phase 1–5 suite remains unchanged in behavior. Real Stripe end-to-end acceptance is still blocked by the missing normalized provider fixture pair; no fixture was fabricated.

Deliberately static: automatic ChangeSpec drafting, GitHub/Dependabot, Python runtime, reasoning, repair, fleet, and generalized provider fixture selection. Phase 7 should focus on replacing remaining explicit fixture/entry-point assumptions and broadening the supported registry, without moving GitHub concepts into L1.
