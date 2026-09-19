# Isotope Agent Transfer — Phase 5 complete

## Purpose and current state

Isotope detects behavioral incompatibilities caused by dependency/provider changes. Its trust hierarchy is static/dataflow scope, isolated dual execution, deterministic structural diff, semantic reasoning only for residual questions, and authoritative mechanical failures. Repair is not implemented. Node 20 and pnpm workspaces are the supported environment; there is no hosted backend or database.

Phase 5 is complete and pushed. The checkout is clean on `main`:

- `4830fc0` — Implement bounded TypeScript behavioral resolver
- `0464e23` — Integrate generated BDG into scan and verify
- `a804782` — Document and validate Phase 5 resolver
- `0fd5b17` — Merge remote main before publishing Phase 5

Remote: `https://github.com/hmartel222/hophacksf26.git`; `origin/main` points to `0fd5b17`. Do not reset, clean, or rewrite this history. Phase 5 changes were intentionally separated into resolver, CLI integration, and tests/docs commits. The merge commit reconciles a remote Phase 4 history that had different commit IDs; local validated files were retained after conflict inspection.

## Read first

Use this file, then inspect current repository files. The authoritative architecture is the Isotope Master Technical Specification v3.0 in `docs-v3-spec.md` (and the user-supplied prompt). Relevant implementation audits are:

- [Phase 5 audit](docs/PHASE5.md)
- [Resolver README](packages/resolver-ts/README.md)
- [Phase 4 audit](docs/PHASE4.md)
- [Harness README](packages/harness-ts/README.md)
- [Differ README](packages/differ/README.md)

The checkout is more authoritative than this handoff for exact code. Start with `git status --short`, `git log --oneline -8`, and `git remote -v`.

## What Phase 5 implemented

`@isotope/resolver-ts` now exports a real bounded resolver conceptually equivalent to:

```ts
resolveBehavioralDependencyGraph({
  repositoryRoot,
  entryPoints,
  changeSpec,
  config,
}): Promise<BDG>
```

The existing core-compatible resolver input remains supported. The resolver does not load old/new fixtures, signatures, verdicts, repair state or GitHub state, and never executes or mutates customer source.

### Frontends and bounds

- Primary analysis uses `ts-morph@26.0.0` and the actual TypeScript checker.
- Existing root `tsconfig.json` compiler options and path aliases are used when valid.
- JavaScript without a useful TypeScript project uses `@babel/parser@7.28.5`, lowered into the same neutral syntax representation and propagation engine.
- Configured entry points plus local imports are admitted deterministically, honoring ignore globs.
- Obvious generated/dependency/artifact directories are excluded: `node_modules`, `.git`, `dist`, `build`, `coverage`, `.isotope`.
- Customer source admission is capped at 200 files; `file_limit:200` is emitted instead of silently claiming complete coverage.
- The expression budget is 30,000 operations per entry.
- One local function/helper hop and one provider-client re-export/import hop are supported.
- Recursive and mutually recursive calls terminate at the bound. Loops use a diagnosed single-pass body plus conservative join.
- Unsupported syntax/operations and invalid or ignored files become canonical `BDG.skipped` diagnostics.

### Provenance and confidence

Provider packages come from `changeSpec.detection.ecosystems.npm.packages`; root patterns come from `changeSpec.detection.taint_roots`. The resolver never branches on `provider === 'stripe'` or another provider name.

Supported provider evidence includes explicit default/named/namespace imports, literal CommonJS `require`, constructor instances, aliases, one local re-export hop, provider calls, and explicitly annotated provider-declared types proven by the checker. Inferred SDK result types do not bypass an unsupported call or the re-export bound.

Confidence rules:

- direct provider call or checker-proven provider type: `high`
- one-hop helper parameter or one-level re-export: `medium`
- heuristic or dynamic/indeterminate evidence: `low`

Confidence never increases downstream. A parameter name or field name alone is not provider proof. Low-confidence evidence may be reported but never schedules authoritative execution or repair. The PAY.JP false-positive case produces zero authoritative Stripe sites and `no_taint_root`.

### Propagation and paths

The engine uses an explicit statement worklist, taint facts, environments, visited state, branch snapshots and joins. Supported flows include:

- sequential `const`/`let` bindings and aliases;
- nested object and array destructuring, including aliases;
- dot access, quoted bracket access and array/index access;
- `await`;
- casts, preserving taint and setting `castSuppressed`;
- arithmetic, `new Date`, templates and straightforward conversions;
- `map`, `reduce`, `sort`, `Math.max`, `Math.min`, with `aggregation: true` where applicable;
- tainted `if` conditions and supported conditional/short-circuit assignments;
- exactly one statically resolvable local helper hop;
- sequential reassignment clearing taint when assigned a proven untainted value;
- recursive termination and bounded diagnostics.

Paths are structural parsed segments, not substring matches. Conventional webhook envelope prefixes `data.object` are normalized away. Numeric array indices become `[*]`; dynamic keys are indeterminate and never guessed. Both removed and replacement paths are retained, so replacement and aggregation flows remain in the graph.

### Graph and sinks

The existing runtime-validated BDG schema was preserved; no artifact contract/schema changes were needed. Meaningful nodes are only:

`taint_root`, `binding`, `transform`, `branch`, `local_call`, `sink`

Edges use `flows_to`. Affected sites use the existing `AffectedSite` contract and include change/path/provenance/source-node/cast evidence plus reachable sink IDs. Node IDs hash stable repository-relative locations, node kind, path, operation and call context. Nodes, edges, sites, sinks and diagnostics are sorted deterministically. Locations have file, start line/column, and end line (the existing schema has no end-column field).

Configured mocks are the strongest sink identity source and use the same canonical dotted identity as L3. The six existing sink kinds remain exactly:

`db_write`, `http_out`, `queue`, `email`, `returned_state`, `log_only`

Additional bounded recognition covers entry returns, `res.json`/`res.send`/`res.end`, unshadowed `fetch`, imported axios methods, `console`/common logger methods, and configured response boundaries. Provider SDK calls are not automatically classified as customer `http_out` sinks. Multiple sink flows are retained.

## CLI integration

`isotope scan` now loads config and the explicit known ChangeSpec, runs real L2, validates/writes `.isotope/bdg.json`, and prints a concise summary of ChangeSpec, entry point, roots, affected sites, confidence, transforms, sinks, bounds, diagnostics and artifact path. It never runs L3 or requires fixtures. `bdg.stub.json` is historical/golden fixture material only; it no longer drives normal verification.

`isotope verify` now runs explicit ChangeSpec → real L2 → existing L3 → L4 → current L6. A no-root result skips before customer execution (`SKIP`, exit 0). If the static analysis is incomplete before a root can be found, verification returns `INDETERMINATE`, exit 4. Runtime mechanical evidence remains authoritative even when static bounds prevent BDG association. Multiple configured entries are sorted deterministically, execute in isolated scoped artifact roots under `.isotope/entries/<entryId>/.isotope/`, and aggregate with the existing worst-verdict behavior. Single-entry artifact paths remain compatible apart from deterministic entry identity handling.

The explicit walking-skeleton fixture-selection seam remains as before. This phase does not implement automatic dependency/ChangeSpec selection, automatic entry-point discovery, or generalized provider fixture selection.

## Validation evidence

Required toolchain used: Node 20.19.5 and pnpm 9.15.9. Final validation in this checkout:

- `pnpm typecheck`: pass
- `pnpm test`: **282 passed**, zero failures/skips
- `pnpm build`: pass
- scoped Phase 4 differ/core verdict coverage: 100% statements, branches, functions and lines (this is not resolver or repository-wide coverage)
- `pnpm isotope --help`: pass
- standalone scan: one provider root, one high-confidence affected site, reachable `db.subscription.update` / `db_write`
- synthetic identical control: PASS, exit 0, empty stable diff
- synthetic broken pair: FAIL, exit 1; exact divergence pointer `/calls/0/args/0/data/renewalDate`, `1700000123` → `__undefined__`, `value_to_missing`, mechanical/critical; generated `bdgNodeId` points to the reachable DB sink
- aggregation integration: valid-to-valid value change with `aggregation: true`, semantic residual, ESCALATE exit 3
- wrong-provider integration: no authoritative Stripe flow, `no_taint_root`, no execution
- multiple entries: deterministic scoped artifacts and aggregate FAIL/PASS behavior
- one-hop helper and recursive/two-hop cutoff tests: pass
- cutoff before root: INDETERMINATE exit 4 without execution
- runtime mechanical loss beyond static cutoff: FAIL exit 1, with null `bdgNodeId`; static uncertainty does not weaken runtime evidence
- existing Phase 4 PASS/FAIL/ESCALATE/INDETERMINATE regressions: pass

Generated BDG, IsotopeReport, DiffReport, VerdictReport and referenced Signature artifacts were read through canonical validators. Local ignored snapshots are under `.isotope/phase5-validation/{control,broken}`; they are not committed.

## Known blockers and limitations

The real provider acceptance command was run and returned blocker exit 10 because these files remain absent:

```text
fixtures/normalized/sub-updated-single/old.json
fixtures/normalized/sub-updated-single/new.json
fixtures/normalized/sub-updated-single/meta.json
```

Do not fabricate them. Synthetic fixtures are valid for unit/integration engineering tests but do not count as provider-produced acceptance evidence. No public corpus benchmark was run; `corpus` contains only its existing README.

The resolver is intentionally bounded, not whole-program analysis. Unsupported or limited areas include arbitrary classes/methods, dynamic imports/dispatch, deep re-export chains, general callbacks, heap/property mutation, exception flow, full loop convergence, arbitrary ChangeSpec predicate evaluation, and arbitrary pattern syntax. Type roots require available provider declarations and explicit annotations. The configured ChangeSpec, entry points, mock boundaries and current walking-skeleton fixture selection remain explicit.

Do not start Phase 6 as part of this handoff. The intended next phase is bounded L5 semantic reasoning over validated residual divergences and causal BDG evidence, with replay/held-out tests and mechanical-failure precedence preserved. Repair, codemods, GitHub reporting, fleet, Python, and broad corpus work remain out of scope.

## Safe next-agent workflow

1. Read this file, `docs-v3-spec.md`, `docs/PHASE5.md`, and `packages/resolver-ts/README.md`.
2. Verify `git status --short` is clean and `git log --oneline -6` ends at `0fd5b17`.
3. Use the Node 20 toolchain (`/Users/rohanbutani/Library/pnpm/nodejs/20.19.5/bin` if present).
4. Run focused tests before changing architecture: `pnpm typecheck`, `pnpm test`, and `pnpm build`.
5. Preserve the existing contracts and the rule that runtime mechanical failures cannot be cleared by missing/low-confidence BDG evidence.
6. Do not reset or clean the checkout, fabricate provider fixtures, auto-push, or begin Phase 6 unless explicitly requested.
