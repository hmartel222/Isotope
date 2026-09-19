# @isotope/repair

Deterministic Phase 9 hypothesis generation and isolated patch application. The package never declares a repair verified; only `@isotope/verifier` can produce that artifact after re-execution.

Candidate edits are anchored to high/medium-confidence BDG sites, restricted to the BDG-derived allow-list, checked against an independent deny-list, and applied only in a detached worktree or bounded temporary copy. `withAppliedCandidate` guarantees cleanup on success or failure.
