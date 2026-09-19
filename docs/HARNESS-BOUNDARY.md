# Harness boundary changelog

- `packages/changespec/src/specimen.ts`: the legacy test helper now loads the sole human-verified registry entry instead of a named provider path. Covered by existing selection tests and `tests/boundary.test.cjs`.
- `packages/cli/src/fixtures.ts`: fixture validation is provider-neutral and reads either flat or normalized nested version metadata. Covered by fixture and boundary tests.
- `packages/harness-ts/src/plan.ts` and `src/index.ts`: provider behavior is compiled from `isotope.yml`; built-in provider adapters were removed. Covered by harness runtime and invented-provider tests.
- `packages/cli/src/verify-repository.ts`, CLI, and Action: spec/fixture registries may live outside the customer repository; the Action defaults to its bundled registries. Explicit `--spec` selection was added to scan/verify paths.
- `action/src/index.ts`: hyphenated GitHub Action input names are read exactly as GitHub exports them. Blank optional inputs (GitHub sets unused inputs to `""`) no longer override the bundled ChangeSpec/fixture registry defaults. Covered by `tests/phase8-action.test.cjs`.
- `packages/cli/src/verify-repository.ts`: empty `specsPath` is rejected instead of resolving to the customer repository root (which previously parsed `.github/dependabot.yml` as a ChangeSpec). Absolute registry paths stay outside the customer checkout. Covered by the bundled-registry Action test.
- workflows: removed `corepack enable` and included hidden `.isotope` files in artifacts.
- `tools/build-action.mjs`: copies the ChangeSpec and normalized fixture registries into `action/registry/` so a customer checkout does not need `specs/` or `fixtures/`. Covered by the bundled-registry Action test.

No reasoner or planner prompting logic changed.
