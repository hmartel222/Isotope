# Phase 4 implementation audit

## Before changes

Phase 3 L3 was intact: reusable plans, generated isolated Vitest execution, configurable mocks, entropy controls, bounded serialization, egress protection, and fresh state. The minimal differ already compared behavioral views recursively and checked determinism, but classified object additions and argument growth as generic value changes, used JavaScript `typeof`, and downgraded every log-only finding. Its BDG lookup selected the first name match. The resolver gated even proven mechanical failures on static provenance and mapped semantic residuals to INDETERMINATE.

Baseline Node 20.20.2 / pnpm 9.15.9 checks passed: typecheck, **144 tests**, build. Synthetic CLI control: PASS/0. Synthetic broken pair: stable old/new, HTTP 200 on both, `value_to_missing`, mechanical/critical, FAIL/1. Existing saved signatures and diff were inspected. The actual provider command returned exit 10 because the normalized Stripe pair is still absent; the new prompt's assertion of real-provider acceptance does not change that repository fact.

## Changes and contract compatibility

- `differ`: pure traversal, complete structural categories, deterministic missing/type semantics, precise pointers, ordered call identity replacement, exact semantic log downgrade, unique/scoped BDG mapping, and ambiguity annotation.
- `core`: structural L6 precedence and unavailable semantic routing; pure routing helpers; pure portable signature reference construction reused by artifact paths.
- `cli`: ESCALATE/exit 3 and visible unavailable-reasoner messaging. Static scope and actual L3 execution are preserved.
- Tests/documentation plus c8 development dependency and a per-file coverage gate. No harness source or runtime behavior changed.

**No artifact schema changes.** Phase 1 already included every divergence kind and optional `ambiguityCandidate`. Additive TypeScript API changes: exported `ChangeContext { ambiguitySatisfied, affectedPointers }`, optional `DiffInput.changeContext`, and optional `DiffInput.bdg`. Existing callers remain compatible. `signatureArtifactRef` preserves the prior artifact filenames without consulting platform/cwd from L4. The additional resolver check rejects a diff for the wrong entry point as an artifact error.

Interpretations needed by v3 are documented in the [differ package](../packages/differ/README.md): specific leaves take precedence over generic argument changes; new array slots are semantic rather than `field_added`; old-only/changed errors are semantic; only semantic log kinds are downgraded; missing-to-defined or already-missing presence changes remain semantic. The empty report represents identical behavior.

## Final recovery validation — September 19, 2026

Recovered checkout: `main` at `903a45f` (`part of phase 4`), with `81729f4` and `1f5dc91` in local history. The working tree was clean; the interrupted Phase 4 edits were already committed. `origin` points to `https://github.com/hmartel222/hophacksf26.git`; remote publication was not checked. No standalone `transfer.md` existed, so the supplied handoff and repository v3 specification were used. No implementation fixes were required, and this recovery made no commit or push.

Validation used the locally installed **Node 20.19.5 / pnpm 9.15.9**, rather than the default Node 24. The old `/tmp/isotope-toolchain` and coverage log were absent. A frozen-lockfile install restored the missing c8 dependency without changing the lockfile; downloads required network permission.

- `pnpm typecheck`, `pnpm build`, and `pnpm isotope --help`: passed.
- `pnpm coverage:differ`: **69 tests passed**; 100% branches, statements and lines in every covered file. Function coverage: `behavior.ts` 100%, `index.ts` 90.9%, `verdict.ts` 100%. All configured 90% per-file gates passed.
- Final `pnpm test`: **227 passed, zero failures or skips**, including all **11 Phase 4 integration scenarios**. Full-suite coverage was **100% branches, statements, lines and functions** for both differ source files and the core verdict resolver.
- Synthetic walking-skeleton control: **PASS / exit 0**, stable, no divergences.
- Synthetic broken pair: **FAIL / exit 1**, stable, with `/calls/0/args/0/data/renewalDate`: `1700000123` → `__undefined__`, **`value_to_missing` / mechanical / critical**. All four runs returned HTTP 200.
- Real-harness semantic defined-value change: **ESCALATE / exit 3**, `value_changed`, unavailable provenance. Object-field additions and semantic log-only changes: **PASS / exit 0**, informational evidence retained. Unstable self-comparisons: **INDETERMINATE / exit 4**, only instability findings.
- Read and schema-validated all **nine saved artifacts for each manual control**, including four signatures, graph, selected specs, diff, verdict and report. Snapshots remain in ignored `.isotope/phase4-validation/{control,broken}/`. Integration tests also read and validate their written signatures, diff and reports before cleanup.

Environment caveats: the first sandboxed suite could not bind the local egress-test listener (`listen EPERM`). With permission, that test passed and observed zero connections, but that run encountered a transient `kill EPERM` in timeout cleanup. The timeout test then passed in isolation, and the final full suite passed. No cleanup exception was suppressed and no test was weakened; recurrence of that process-cleanup error merits investigation.

The real-provider command was also run: **exit 10**, because `fixtures/normalized/sub-updated-single/{old,new,meta}.json` remains absent. No provider payloads were fabricated. Phase 4 software validation is complete; real-provider acceptance remains blocked.

## Structural and verdict rules confirmed

L4 remains pure and deterministic. Object keys traverse in sorted order, arrays retain numeric order, and calls compare positionally by `(mock, sinkKind)`; replacement emits dropped then added. Defined-to-null/undefined/absence is authoritative loss, whereas `0`, `false` and the empty string are defined. New object keys are informational; array growth is semantic. Specific leaf findings take precedence over generic argument changes.

BDG association requires a unique matching name/kind and a sink node in the selected entry point; otherwise it is null. Confidence never weakens mechanical evidence. Caller-evaluated ambiguity facts annotate only relevant semantic pointer subtrees and decide no verdict. Invalid artifacts remain validation errors.

Pure L6 routes instability first to **INDETERMINATE/4**, then mechanical critical/high to **FAIL/1**, semantic residual to **ESCALATE/3** (`semantic_reasoner_unavailable`), and info-only or identical behavior to **PASS/0**. Harness failures retain Phase 3's conservative INDETERMINATE/4 behavior. No model can override a mechanical failure.

## Future seams and deliberately static work

The differ knows no provider or application policy. Semantic records retain kind, pointer, normalized old/new, sink, graph association and optional ambiguity hint. L6 always bypasses semantic adjudication for proven mechanical failures. Original-old versus patched-new signatures work unchanged because code-version metadata is excluded from behavior.

No AST, model, repair, Python, GitHub or aggregate-verdict implementation was added. ChangeSpec selection, the CLI's explicit entry point and its BDG remain static. There is no safe ambiguity predicate evaluator yet; callers pass already-evaluated facts, and the CLI does not claim to evaluate arbitrary spec strings.

Phase 5 should replace `bdg.stub.json` loading in `packages/cli/src/walking-skeleton.ts` with `packages/resolver-ts/src/index.ts`. The actual resolver must discover provider-call/type provenance, propagate fields through bindings/transforms/calls, resolve aliases/re-exports and configured sink boundaries, produce accurate entry-point/source locations, and associate affected sites with selected ChangeSpec changes and sink nodes. Current L4 name/kind/entry matching can then consume that graph. Do not replace the configured runtime mocks with AST guesses or let provenance confidence weaken observed structural losses.
