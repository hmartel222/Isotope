# @isotope/repair

Phase 9 deterministic hypothesis generation, Phase 11 bounded L8 planner, and isolated patch application. The package never declares a repair verified; only `@isotope/verifier` can produce that artifact after re-execution.

Deterministic edits remain AST-anchored `path_rename` transforms. Model edits are anchored replacements from a `RepairPacket` that excludes held-out evidence. Candidates of either origin are restricted to the BDG-derived allow-list, checked against an independent deny-list, and applied only in a detached worktree or bounded temporary copy. `withAppliedCandidate` guarantees cleanup on success or failure.

