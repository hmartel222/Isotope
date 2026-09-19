# Snowflake provider

Snowflake is registered as an **outbound SDK** provider (`snowflake-sdk` → `createConnection` / `execute`). Evaluation is **synthetic only**. There is no live Snowflake connection, no PAT, and no warehouse.

| Capability | Status |
| --- | --- |
| Provider registered | yes |
| Dependency matching | yes (`npm:snowflake-sdk`) |
| ChangeSpec selection | yes (`snowflake.query.account-renewal`) |
| Static provenance | yes (`$CONN.execute($$$)`) |
| Deterministic SDK boundary | yes |
| Synthetic fixture suite | yes |
| Synthetic full-pipeline acceptance | yes (`matrix --provider snowflake`) |
| Reasoner acceptance | synthetic cassettes only |
| Deterministic repair acceptance | yes (`path_rename` on `ACCOUNT_RENEWAL` → `RENEWAL.AT`) |
| Held-out repair verification | yes |
| Real Snowflake fixtures | **no** |
| Production validated | **no** |
| Credentials / live network | **no** |

Corpus under `corpus/cases/fixtures/snowflake-*` and `corpus/cases/repositories/snowflake-*` is `meta.synthetic: true`. The harness intercepts `snowflake-sdk` and returns fixture rows. That proves the provider seam, not a vendor API version.

```sh
./node_modules/.bin/tsc -b
node packages/cli/dist/bin.js providers
node --test tests/snowflake.test.cjs
node packages/cli/dist/bin.js matrix --provider snowflake
```

One case:

```sh
node packages/cli/dist/bin.js matrix --case snowflake-mechanical-break
```

Downstream detection (same upgrade commit, different sinks):

```sh
node packages/cli/dist/bin.js matrix --case snowflake-downstream-helper
node packages/cli/dist/bin.js matrix --case snowflake-downstream-email
node packages/cli/dist/bin.js matrix --case snowflake-downstream-http
node packages/cli/dist/bin.js matrix --case snowflake-downstream-queue
node packages/cli/dist/bin.js matrix --case snowflake-downstream-sibling
```
