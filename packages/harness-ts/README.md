# TypeScript isolation harness (Phase 3)

L3 executes one explicit entry point without depending on ChangeSpecs, a BDG, verdicts, reasoning, or repair. The CLI translates config and fixture metadata with `createTsHarnessPlan`, then calls `runTsHarness` four times. The existing `runHarness(HarnessInput)` stage remains a compatibility wrapper. No core artifact schemas changed.

```ts
const plan = createTsHarnessPlan({ repoRoot, entryPoint, config, fixture, codeVersion: 'original' }, 'old', 0);
const signature = await runTsHarness(plan);
```

`TsHarnessPlan` contains repository root, file/export/kind/ID, explicit fixture pair/side/version/path, code version, configured mocks/returns, provider interception requirement, and run index. Optional `outputPath` writes a validated Signature under the supplied root (including a future repair artifact directory). `patched:<repairId>` uses identical execution semantics. No assumption ties the supplied root to the original checkout.

## Execution and isolation

The parent normalizes paths, creates a private temporary plan/result directory, generates one deterministic `.isotope/generated/<identity-hash>.<side>.<run>.spec.ts`, and spawns Node with an argument array. The child drives Vitest's programmatic `startVitest`, with customer test configuration disabled and exactly that generated test included. An exclusive generated-file create prevents simultaneous identical plans from racing. Distinct entries, fixture versions/sides, runs, and code versions have distinct names.

Each invocation gets fresh child/module/mock/provider/fixture state. Stdout and stderr are bounded diagnostics, never protocol data. The child writes a separate JSON result; the parent checks schema, execution identity, call sequence and child success before accepting it. The generated wrapper, private plans, placeholder modules, results, and temporary directory are removed in `finally`, on success or failure. Generated wrappers are not retained. Authoritative signatures survive cleanup.

Default parent timeout: **20 seconds** (internal test override 1–120,000ms). On macOS/Linux, an isolated process group is killed on timeout or runner exit, including Vitest descendants. Both synchronous loops and unresolved promises are tested, including checking the worker PID is gone. Windows has direct-child termination only; process-tree cleanup there is not certified.

Only PATH, private HOME/TMPDIR, CI, NO_COLOR, TZ and internal harness variables enter the child. Provider, database and model credentials are not inherited. Source files are not rewritten.

## Mock and adapter rules

- Local mock paths resolve from the supplied repository/config root, **not** the entry file or generated test. `src/db.ts` preserves the Phase 2 convention. Use `./lib/db` for other local prefixes; `./` and `../` always denote local files. Extensionless local files try TS/JS and index variants. Entry/local mock realpaths must remain within the root, including symlink targets. A `../src/db` that escapes the root is rejected.
- Bare package specifiers such as `stripe` or `@sendgrid/mail` use private placeholder modules plus Vitest mocks; those packages need not be installed. Arbitrary non-mocked imports must be available in the target repository. Builtin observable mocks are unsupported.
- Fixtures may be explicit files outside the target root, preserving the existing shared normalized-fixture layout. They are read fresh, never written. Relative fixture paths resolve from the root.
- Each configured `recordAll` export is a recursive callable Proxy. Property access does not record; invocation records a dotted name, canonical sink kind, ordered arguments, and globally increasing sequence. `then` is always absent so awaiting an object does not accidentally invoke a mock. Default exports use names beginning with `default`. All six canonical sink kinds are accepted.
- Full dotted names select deterministic returns. Every invocation gets a fresh clone; unconfigured calls return `undefined`. Plain values naturally support `await`.
- Provider strategies resolve to descriptors. The generic `fixture-call` adapter declares exports, fixture-returning call paths, request headers, and optional recorded boundaries without changing harness code. Specialized compatibility behavior is isolated under `src/provider-adapters`. A configured provider mock must actually invoke interception; installing it alone is insufficient.
- Implemented adapters: `express_route` (raw Buffer body/rawBody, headers, status/statusCode/json/send/end) and `plain` (fixture → returned value). HTTP state is represented once in `Signature.returned`; response bodies are snapshotted when sent. Next App Router, Next Pages API, and Lambda return `adapter_not_implemented`, with no fallback. This is a deliberately small structural Express adapter, not a full framework emulator.

## Deterministic behavior and serialization

Before importing customer code, Date is frozen at `2026-01-01T00:00:00Z`, Math.random returns `0.42`, and Node/default/named/Web Crypto UUID APIs return `00000000-0000-4000-8000-000000000000`. Other crypto functionality remains intact. Only Date is faked so awaited ordinary timers still progress. Controls are restored and cannot affect the parent. These stabilize known sources; they do **not** prove arbitrary determinism. Old twice/new twice and metadata-free self-comparison remain mandatory.

Snapshots occur at each mock call and response boundary. Sorted object keys, ordered arrays, `__undefined__`, `__NaN__`, `__Infinity__`, `__-Infinity__`, ISO Dates, `__fn__`, `__circular__`, and `{ __buffer__: <sha256> }` follow v3. Extensions: BigInt uses `__bigint__:<decimal>` and invalid Dates use `__invalid_date__`. Shared non-cyclic objects serialize normally. Symbols, accessors, and unsupported object classes fail explicitly rather than silently disappearing.

Depth is capped at 20, breadth at 500; stable sentinels mark deterministic prefix truncation. Extra defensive limits: 10,000 visited nodes, 65,536 characters per string/key, 1 MiB total text per snapshot, 4 MiB cumulative snapshots, 5,000 calls, 8 MiB result file, 16 KiB each stdout/stderr diagnostic. Any observed truncation becomes `serialization_limit`; truncated evidence cannot yield a normal Signature or false PASS. Customer errors contain bounded name/message only, no volatile stack.

## Egress and failures

`NODE_OPTIONS=--require .../block-net.cjs` installs blocking before the runner and all Vitest forks. It blocks HTTP(S) request/get, net socket/connect/createConnection, TLS, UDP send/connect and fetch; builtin ESM exports are synchronized. The VM fetch global is also patched. Attempts are recorded in a private bounded diagnostic stream containing API names, never URLs, headers, or request bodies. The parent checks this stream even after child failures; a caught blocked exception cannot hide egress. A local listener test proves zero connections across fetch/http/https/net/named imports.

This is Node-level accidental-egress protection, not a hostile-code OS sandbox: deliberate removal of controls, native binaries, arbitrary filesystem I/O, or subprocess escape are outside this phase. Configure observable I/O boundaries explicitly. No model or provider network stage runs here.

Customer exceptions belong in `Signature.threw`. Setup/import failures, missing exports, unsupported adapters, malformed results, provider interception failure, serialization failure, process exits and timeouts are typed `HarnessExecutionError`s. Diagnostics retain stage, entry ID, generated path, exit/signal and bounded output. The existing CLI conservatively maps harness failures to INDETERMINATE/exit 4 and emits no comparison evidence. This preserves Phase 2 exit behavior rather than introducing an incompatible exit 11 mapping.

## Tests

`tests/phase3.test.cjs` uses the tiny `test-projects/` engineering corpus. These are synthetic internal tests, not provider fixtures or benchmark evidence. Run `pnpm test`; local-listener permission is needed for the zero-egress assertion. The Phase 2 integration tests retain their original PASS/FAIL and artifact checks. See `docs/PHASE3.md` for acceptance results and remaining scope.
