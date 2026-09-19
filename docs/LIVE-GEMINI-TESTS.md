# Live Gemini API acceptance tests

The live suite demonstrates Isotope against the real Gemini API without making normal CI depend on network access, credentials, model availability, or billable calls. It is separate from the deterministic cassette suite.

## Coverage

The suite exercises provider-neutral evidence rather than Snowflake-specific behavior:

- API connectivity and JSON response mode
- semantic incompatibility classification
- evidenced benign adaptation
- unresolved business-policy escalation
- prompt-injection handling
- independent two-vote consensus
- packet-relative evidence citation validation
- sensitive-looking payload non-disclosure
- bounded repair candidate generation
- planner refusal when policy is missing
- planner refusal of injected workflow edits
- strict file and changed-line limits
- self-consistency without model arbitration
- insufficient-evidence refusal
- coordinated multi-file planning
- confirmation that planner output never claims independent verification
- a complete `FAIL_REASONED` to L8 planner to ephemeral L9 application to held-out L10 verification flow
- confirmation that the original checkout remains byte-for-byte unchanged

The final case uses the controlled `corpus-coord` repository and synthetic planning/held-out fixtures. It demonstrates product plumbing and trust boundaries; it is not provider-produced fixture acceptance.

## Run locally

Use a Gemini key through the environment. Do not save it in the repository.

```sh
export GEMINI_API_KEY='...'
export ISOTOPE_LIVE_GEMINI=1
node --test --test-concurrency=1 tests/live-gemini-api.test.cjs
```

`GOOGLE_API_KEY` and `GOOGLE_GENERATIVE_AI_API_KEY` are also accepted. To save a machine-readable demo result:

```sh
export ISOTOPE_LIVE_RESULTS="$PWD/.isotope/live-gemini-results.json"
node --test --test-concurrency=1 tests/live-gemini-api.test.cjs
```

The suite is intentionally serialized. A complete run can make multiple model calls and may take several minutes. Gemini responses remain external behavior, so a failure should retain the emitted classification and test name for review rather than being converted into an offline cassette expectation.

## Run in GitHub Actions

Store the key as an Actions secret named `GEMINI_API_KEY`. Live tests should use a manually dispatched workflow or a protected environment; do not run them for untrusted pull requests or Dependabot branches.

```yaml
name: Live Gemini acceptance
on:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  live-gemini:
    runs-on: ubuntu-latest
    environment: live-model-tests
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: corepack enable && pnpm install --frozen-lockfile
      - run: pnpm build
      - run: node --test --test-concurrency=1 tests/live-gemini-api.test.cjs
        env:
          ISOTOPE_LIVE_GEMINI: "1"
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          ISOTOPE_LIVE_RESULTS: .isotope/live-gemini-results.json
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: live-gemini-results
          path: .isotope/live-gemini-results.json
          if-no-files-found: warn
```

This workflow must live on the trusted default branch. Keep it manual until call cost and model stability are understood.
