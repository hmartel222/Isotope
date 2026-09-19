# L2 TypeScript/JavaScript dataflow resolver

`resolveBehavioralDependencyGraph` reads customer source and emits the existing, runtime-validated v3 `BDG`. It does not load fixtures, execute customer modules, decide verdicts, or depend on harness, differ, reasoner or repair packages.

```ts
const bdg = await resolveBehavioralDependencyGraph({
  repositoryRoot,
  entryPoints: config.entryPoints, // optional; defaults to config.entryPoints
  changeSpec,                    // exactly one human-verified ChangeSpec
  config,
});
```

The original core `ResolveInput` (`repoRoot`, `config`, `selectedSpecs`) remains accepted with exactly one selected spec. The new input type is exported as `ResolverInput`. Configured entries are sorted deterministically and duplicate entries are rejected. No entry-point discovery or dependency-based spec selection occurs.

## Frontends and bounds

`project.ts` admits configured source files and their local imports, honoring `config.ignore` globs and excluding `node_modules`, `.git`, `dist`, `build`, `coverage`, and `.isotope`. Real paths must stay inside the supplied repository. The customer-source cap is **200 files**; omissions produce `file_limit:200`. Provider package declaration files are available to the checker as type evidence and are not analyzed as customer behavior.

The primary frontend uses **ts-morph and the actual TypeScript checker**, with compiler options and path aliases from the root `tsconfig.json` when usable. It does not add the tsconfig's whole source set or emit/save source. JS without a usable tsconfig is parsed by **@babel/parser**, lowered to the same small syntax representation, and uses the same propagation engine. JS fallback explicitly reports `js_fallback:explicit_import_provenance_only` and caps call-root confidence at medium. Invalid source syntax is an analysis error.

`syntax.ts` describes supported operations; unmodeled constructs remain explicit unsupported nodes. `engine.ts` uses a statement worklist, environments containing taint facts, visited-state tracking, branch snapshots/joins, **one local-function hop**, **one provider-client import/re-export hop**, and a **30,000 expression-operation budget per entry**. Recursive and mutually recursive helpers stop at the call bound. While/do loops use a single body pass joined with the incoming state and emit `loop_bound:one_iteration_join`; this is not a fixed-point proof. For-loop headers/iterator bindings are unsupported and separately diagnosed.

## Provenance and confidence

Provider packages come exclusively from `changeSpec.detection.ecosystems.npm.packages`; call patterns come from `detection.taint_roots`. There is no branch on a provider name.

- Direct default/named/namespace imports, unshadowed literal `require`, constructor instances, and aliases establish provider bindings. One local export/import preserves a client at medium confidence.
- The supported call-pattern grammar is `$BINDING.member[.member... ]($$$)` with ordinary dotted member names and no space in a member chain. The pattern is parsed as TypeScript syntax; the receiver must resolve to a provider binding. Arbitrary pattern expressions are rejected, not substring-matched.
- Typed entry parameters and explicitly annotated local declarations become type roots only when the checker locates the type's declaration inside the provider package. Local lookalike interfaces and names are insufficient. Inferred call-result types do not bypass an unsupported call or the re-export bound. Qualified type-pattern names are accepted; checker declaration provenance supplies the proof.
- Direct provider call/type roots are high. One-hop parameters and re-exported clients are medium. Confidence can only decrease through bindings, constructed-object fields, transforms and sinks. JS fallback call roots are medium.
- A parameter named exactly for a ChangeSpec object can be reported as low-confidence `name_heuristic`, with `heuristic_only:unproven_parameter` and `no_taint_root`. This is not provider proof. Dynamic unknown keys also lower existing evidence to low and set `indeterminatePath`.

The CLI never schedules execution solely from heuristic roots. If execution has already produced a mechanical failure from a proven root, imperfect static association cannot weaken that runtime evidence.

## Propagation and paths

Supported flows include sequential bindings/aliases; nested object and array destructuring; dot and quoted bracket access; numeric/known-array indexing; await; casts; arithmetic; Date construction; templates; String/Number/Boolean conversion; map/reduce/sort; Math.max/Math.min; direct entry returns; Express response calls; and one statically resolved local helper, including imports. Helper environments use lexical scope, with distinct call contexts. The helper's arguments, parameter bindings and returned data preserve causal edges and conservative confidence.

Provider paths are segment arrays, not substrings. `data.object` is normalized away as the conventional event envelope. Numeric indices become `[*]`; a dynamic index becomes `[*]` only at a known array prefix in the ChangeSpec, otherwise `[?]`. Both `removed_path` and `replacement.path` are parsed and matched by exact segments. Replacement/aggregated flows remain in the graph. Raw source paths also appear on edges. Affected reads get a meaningful binding node; the resolver does not emit a node for every property token.

Defined-to-untainted sequential identifier reassignment clears taint. Block shadowing is kept separate; conditional and short-circuit assignments use conservative joins. A tainted condition emits a branch node without implicitly tainting constant values inside it. Casts retain taint and `castSuppressed`; aggregation creates a transform with `aggregation: true`, retained downstream.

## Observable boundaries and graph output

Configured mock modules/exports are the strongest sink evidence. Local modules resolve from the config/repository root, as in L3. Static identities use canonical exported names, so importing `db as storage` still emits `db.subscription.update`, matching the harness. Namespace/CommonJS imports and callable aliases retain those identities.

The six sink kinds are unchanged: `db_write`, `http_out`, `queue`, `email`, `returned_state`, `log_only`. Additional recognized boundaries are unshadowed fetch, imported axios and common axios methods, console logging/common logger methods, entry return, and the configured Express response parameter's json/send/end chain. Provider SDK calls are not automatically HTTP sinks. A value reaching multiple boundaries retains each flow.

The graph uses only `taint_root`, `binding`, `transform`, `branch`, `local_call`, `sink`, and `flows_to`. Node/entry/site IDs use SHA-256 over stable relative locations, kind, path, operation and call context, truncated to 20 hexadecimal digits. Nodes, edges, sinks, sites and diagnostics have deterministic ordering. Locations contain repository-relative file, start line/column and end line; the existing schema has no end-column field. `AffectedSite` references its path/cast-bearing node and includes the change index, provenance and all reachable sink IDs.

No artifact schema changed. Diagnostics use the canonical `BDG.skipped` records (`file`, `reason`). Meaningful diagnostics include `no_taint_root`, `reexport_limit:1`, `local_call_limit:1`, `file_limit:200`, `analysis_budget:30000`, `indeterminate_path:dynamic_key`, invalid tsconfig, ignored/unresolved files, and unsupported syntax/calls/object shapes/loop headers/destructuring.

This is bounded direct dataflow, not whole-program analysis: arbitrary methods/classes, dynamic imports/dispatch, deep re-export chains, heap/property mutation and alias tracking, general callbacks, exception flow, full loop convergence, and arbitrary ChangeSpec predicate evaluation are not implemented. Unsupported operations are diagnosed where encountered. Type roots require available provider declarations; call-root import provenance works without installing/executing the provider SDK in the target project. Source locations and IDs can change when source moves.

## CLI and tests

`isotope scan` loads config plus the currently explicit ChangeSpec, validates/writes `.isotope/bdg.json`, and prints roots, affected paths/confidence, transforms, sinks, bounds and diagnostics. It never invokes L3 or requires fixtures.

`isotope verify` performs real L2 before the existing L3/L4/L6 path. Entries with no proven root produce SKIP/no_taint_root without execution; an incomplete analysis with no proven root produces INDETERMINATE. Runtime FAIL/PASS/ESCALATE/INDETERMINATE behavior is preserved. Multiple configured entries execute in stable order, with isolated artifacts under `.isotope/entries/<entryId>/.isotope/` and a root aggregate report using v3 worst-verdict precedence. Single-entry artifact paths remain unchanged except for the new deterministic entry ID.

`tests/phase5-resolver.test.cjs` and `test-projects/flows/` are synthetic engineering fixtures for provenance, propagation, confidence, path precision and bounds. `tests/phase5-integration.test.cjs` verifies real scan, generated-graph runtime association, semantic aggregation, wrong-provider/heuristic skips, multiple entries and mechanical failure beyond the static call bound. They are not provider-produced acceptance evidence or public-corpus benchmark results. See [the Phase 5 audit](../../docs/PHASE5.md) for final validation results.
