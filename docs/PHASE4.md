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

## Future seams and deliberately static work

The differ knows no provider or application policy. Semantic records retain kind, pointer, normalized old/new, sink, graph association and optional ambiguity hint. L6 always bypasses semantic adjudication for proven mechanical failures. Original-old versus patched-new signatures work unchanged because code-version metadata is excluded from behavior.

No AST, model, repair, Python, GitHub or aggregate-verdict implementation was added. ChangeSpec selection, the CLI's explicit entry point and its BDG remain static. There is no safe ambiguity predicate evaluator yet; callers pass already-evaluated facts, and the CLI does not claim to evaluate arbitrary spec strings.

Phase 5 should replace `bdg.stub.json` loading in `packages/cli/src/walking-skeleton.ts` with `packages/resolver-ts/src/index.ts`. The actual resolver must discover provider-call/type provenance, propagate fields through bindings/transforms/calls, resolve aliases/re-exports and configured sink boundaries, produce accurate entry-point/source locations, and associate affected sites with selected ChangeSpec changes and sink nodes. Current L4 name/kind/entry matching can then consume that graph. Do not replace the configured runtime mocks with AST guesses or let provenance confidence weaken observed structural losses.
