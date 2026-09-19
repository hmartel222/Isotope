# Phase 9 — deterministic repair and independent verification

Phase 9 keeps repair strictly downstream of the existing detection verdict. A mechanical incompatibility is first persisted as `FAIL`; only then may a human-verified `path_rename` codemod become a `CandidatePatch`. Candidates have no authority until L10 independently rebuilds the BDG and re-executes the handler.

## Trust boundary

- `@isotope/repair` implements the pure eligibility gate, restricted predicate evaluator, ts-morph site transform, BDG-derived allow-list, deny-list, anchor/budget validation, detached-worktree or bounded-copy workspace, real unified diff, integrity snapshots, and unconditional cleanup.
- `@isotope/verifier` rebuilds L2 in the patched workspace, runs patched old/new twice, compares original-old against patched-new, performs the secondary patched-old/patched-new comparison, verifies a distinct held-out pair, and enforces provider-root, provider→sink, sink-presence, hardcoded-literal, and suppression checks.
- The original checkout is never patched. No install, commit, branch, push, PR, or merge operation exists in this path.

Business-policy predicates are evaluated before `safe_when`. The supported expression language is intentionally limited to `always`, property paths (including `.length`), integer comparisons, and boolean `&&`; YAML strings are never evaluated as JavaScript. Low-confidence sites, missing held-out fixtures, non-`FAIL` verdicts, and unsafe or unsupported predicates bypass repair.

Successful verification writes `.isotope/repair/verified-repair.json` and returns exit 5 while preserving the original `FAIL` verdict. Rejections write structured verification evidence but never surface candidate code as a recommendation. Outcomes include `did_not_restore_behavior`, `overfit_rejected`, `patch_introduced_nondeterminism`, `patch_invalid`, `degenerate_patch`, and the reserved `ambiguity_after_patch` state.

The internal acceptance corpus contains explicitly synthetic planning and held-out Stripe-shaped fixtures. They test the complete mechanism but are not represented as provider-produced evidence. Product verification continues to reject synthetic files under `fixtures/normalized`.

Semantic reasoning, model repair planning, Python codemods, recursive retries, autonomous Git operations, and repair application to the customer checkout remain out of scope.
