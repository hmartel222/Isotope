# Phase 8 GitHub Action and reporter

Phase 8 packages the deterministic verifier as a bundled Node 20 Action and adds a trust-separated reporter. The CLI and Action both call `verifyRepository`, which owns Git dependency selection, SKIP artifact generation, and invocation of the existing resolver, harness, differ, and verdict pipeline.

The Action reads full base and head SHAs from the `pull_request` payload. It never guesses `HEAD^`, installs dependencies, changes customer source, commits, pushes, or merges. The consuming workflow checks out the PR head with complete history and installs project dependencies before invoking the Action. Phase 8 supports only `reasoner: off`, `repair: off`, and `fail-on: critical,high`; the Gemini input is reserved and no model key is required.

The reporter renders only typed `SelectedSpecs`, `BDG`, `DiffReport`, `Signature`, and `IsotopeReport` data. It escapes and bounds customer-derived strings, caps annotations, maps INDETERMINATE to a neutral check conclusion, and returns no PR comment for SKIP. Its GitHub adapter updates exactly one bot-owned comment containing `<!-- isotope-report -->`; human comments are never edited. Comment or check API failures are recorded separately and cannot change the product verdict.

Three workflow templates are included. `.github/workflows/isotope.yml` uses direct reporting with `contents: read`, `pull-requests: write`, and `checks: write`. The restricted pair uses `isotope-verify.yml` for unprivileged PR execution with only `contents: read`, followed by `isotope-report.yml` on `workflow_run`. The latter checks out trusted default-branch code and consumes a size-bounded, symlink-free artifact tree through Phase 1 JSON schema validation. It never checks out or executes the PR head.

The workflows upload `.isotope/` with `if: always()`. Action outputs are `verdict`, `report-path`, `selected-spec-count`, and `affected-site-count`. Build the checked bundle with `pnpm action:build`.

No authenticated GitHub CLI or controlled demo repository was available in the implementation environment, so ordinary-PR and Dependabot live runs were not claimed. The local suite covers context parsing, the bundled report path, verdict rendering, annotation mapping, bot-owned comment upsert, permission failures, workflow permissions, and the existing five-case detection matrix. A controlled live PR with provider-produced normalized fixtures is the remaining deployment acceptance step.

Phase 9 should begin with bounded L5 evidence packets and replayable semantic reasoning while preserving the mechanical failure and instability bypasses.
