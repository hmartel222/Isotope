# Isotope GitHub Action

The bundled Node 20 action calls the same `verifyRepository` API as `isotope verify --base --head`. It reads the exact pull request SHAs, preserves `.isotope/` evidence, writes bounded outputs and a job summary, and can publish one bot-owned marked comment plus a check with source annotations.

The Action supports `reasoner: on|off` and `repair: on|off`. Repair may run a deterministic ChangeSpec codemod or, when `repair.planner` is `model`, a bounded planner candidate. Both are applied only in an isolated worktree. A verified-repair check stays red because the underlying product verdict remains `FAIL` or `FAIL_REASONED`. Semantic reasoning uses a bounded evidence packet and two independent votes; it cannot override a mechanical `FAIL`. The planner never verifies its own work. The action never installs customer dependencies and has no commit, push, merge, or PR-creation capability.

The direct workflow is `.github/workflows/isotope.yml`. Restricted Dependabot/fork execution uses `isotope-verify.yml` and `isotope-report.yml`: PR code runs with read-only contents permission, while the privileged reporter checks out trusted default-branch code and parses only schema-validated, size-bounded, symlink-free JSON artifacts.

Build the checked bundle with `pnpm action:build`.
