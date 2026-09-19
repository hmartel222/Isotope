# Isotope GitHub Action

The bundled Node 20 action calls the same `verifyRepository` API as `isotope verify --base --head`. It reads the exact pull request SHAs, preserves `.isotope/` evidence, writes bounded outputs and a job summary, and can publish one bot-owned marked comment plus a check with source annotations.

Phase 8 supports only `reasoner: off` and `repair: off`. The Anthropic input is reserved and unused. The action never installs customer dependencies and has no commit, push, merge, or PR-creation capability.

The direct workflow is `.github/workflows/isotope.yml`. Restricted Dependabot/fork execution uses `isotope-verify.yml` and `isotope-report.yml`: PR code runs with read-only contents permission, while the privileged reporter checks out trusted default-branch code and parses only schema-validated, size-bounded, symlink-free JSON artifacts.

Build the checked bundle with `pnpm action:build`.
