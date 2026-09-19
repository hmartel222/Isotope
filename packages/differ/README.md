# L4 structural differ (Phase 4)

`diffSignatures(input: DiffInput): DiffReport` is a pure, in-memory function. No files, fixtures, config, environment variables, models, Git or harness execution are consulted. Both self-comparison pairs are required. The optional BDG enriches evidence; an optional caller-evaluated `changeContext` adds scoped ambiguity hints. Original-versus-patched comparison uses the same API.

```ts
const report = diffSignatures({
  old: signatures.old[0], new: signatures.new[0],
  selfComparisons: signatures,
  bdg,
  changeContext: {
    ambiguitySatisfied: true,
    affectedPointers: ['/calls/0/args/0/data/period'],
  },
});
```

Every Signature is runtime-validated, with contiguous ordered call sequences. Each selected behavior must match its first self-comparison run. Invalid artifacts raise `ArtifactValidationError`, not an instability finding. Reports validate against the existing schema. Only the orchestrator writes artifacts.

## Comparison pipeline

1. Validate evidence and self-compare `returned`, `threw`, and `calls`. Metadata is ignored by the centralized `behavioralView` and `behaviorEqual` helpers.
2. If either side is unstable, emit only self-comparison `unstable` evidence. The pointer index is sorted and deduplicated; evidence from old and new self-comparisons remains distinct.
3. Compare returned state, then thrown state, then calls by numeric sequence. Object keys are sorted, arrays use numeric indices. Divergence IDs follow this deterministic traversal. A replaced call emits dropped then added at the same position.
4. Attach canonical dynamic sink kind, a provable BDG node if available, and a scoped ambiguity hint on semantic evidence only. No timestamp/random ID is introduced.

`identical` means an empty divergence list. The other nine public kinds are emitted as follows:

| Kind | Structural condition | Decision metadata |
| --- | --- | --- |
| `value_to_missing` | Defined value becomes null, `__undefined__`, or absent | mechanical / critical |
| `call_dropped` | Old call absent or replaced at its sequence position | mechanical / critical |
| `threw_new_only` | Only new execution throws | mechanical / high |
| `value_changed` | Differing leaves with the same normalized type; returned-array growth | semantic / null severity |
| `type_changed` | Differing normalized types | semantic / null severity |
| `call_added` | New call absent from old position or replacing its identity | semantic / null severity |
| `call_args_changed` | Added argument/array slot, or removal of an already-missing argument/slot | semantic / null severity |
| `field_added` | New object key, with nothing removed there | mechanical / info |
| `unstable` | Failed old/old or new/new self-comparison | mechanical / null severity |

The exact leaf precedence is equality → defined-to-missing → new object key → array-slot presence change → normalized type change → value change. Missing includes null/undefined-sentinel/absence, never `0`, `false`, or `""`. Other serializer sentinels retain their JSON representation: strings stay strings and Buffer hashes stay objects. Nothing is rehydrated or judged as invalid business data.

`call_args_changed` overlaps other v3 categories. This implementation prefers specific leaf findings. It uses the generic class only for collection-presence changes that lack a more authoritative missing-value finding; no duplicate whole-call summary is emitted. Returned-array growth uses `value_changed`. Removed defined array elements are `value_to_missing`, including removed arguments. New object fields are informational even when their values are null or structured data. Existing-array growth is never mistaken for a harmless field addition.

JSON Pointers use RFC 6901 escaping for `~`, `/`, and empty keys, down to the smallest useful leaf. When an entire subtree disappears, its own pointer and bounded normalized value are retained. Absence is serialized into evidence as `__undefined__`, preserving the existing artifact convention.

## Calls, throws and provenance

Call identity is exactly `(mock, sinkKind)`. Arguments do not affect identity. Reordering or inserting a call shifts later comparisons; no alignment, fuzzy match or LCS hides drops. Dynamic call evidence supplies the sink taxonomy directly. Returned state uses `returned_state`; thrown state retains the existing null sink convention.

New-only throws mechanically fail. Old-only throws map to semantic `value_changed` at `/threw`; differently thrown errors recurse to semantic value/type findings. Removing an optional error-stack field does not become mechanical data loss. Phase 3's error representation is untouched.

Only semantic kinds at `log_only` are downgraded to mechanical/info. Mechanical losses and dropped calls remain critical, including at log-only sinks. This follows the exact scope of the v3 downgrade instead of extending it to all log findings.

A BDG association requires exactly one sink matching dynamic name/kind and a sink node belonging to the selected entry point. Returned sinks require uniqueness too. Missing, duplicate, foreign-entry, or mismatched graph evidence yields `bdgNodeId: null`. Low confidence never changes the structural classification.

`changeContext.affectedPointers` are validated behavioral JSON Pointer subtrees. A satisfied fact annotates relevant semantic findings with `ambiguityCandidate: true`. `/value` does not match `/valueExtra`. The hint decides no verdict, does not apply to mechanical/info findings, and executes no ChangeSpec expression. The CLI does not yet evaluate ambiguity predicates.

## L6 structural routing

The pure resolver in `core/src/verdict.ts` checks:

1. Unstable → **INDETERMINATE**, mechanical.
2. Any mechanical critical/high → **FAIL**, mechanical, regardless of BDG confidence or other semantic findings.
3. Semantic residual → **ESCALATE**, unavailable, reason `semantic_reasoner_unavailable`.
4. Info only → **PASS**, with `only_informational_divergences`.
5. No divergence → **PASS**, with `identical_behavior`.

`hasMechanicalFailure` and `needsSemanticReasoning` expose the structural bypass seam. The latter is a routing hint, not authorization to invoke L5: future code must apply provenance, config and budget rules. Supplied reasoning cannot produce a reasoned verdict in this phase. No L5 stub is called. Per-entry instability dominates; the separate aggregate resolver remains a stub, so no PR-wide precedence was changed.

CLI exits: PASS 0, FAIL 1, ESCALATE 3, INDETERMINATE 4. Harness failures retain Phase 3's conservative exit 4; malformed artifacts are errors, not fabricated instability. Reasoning and repair remain unimplemented.

## Tests and coverage

`tests/phase4-differ.test.cjs` is an independent table-driven suite that constructs valid Signatures without CLI, harness, Stripe or disk fixtures. It covers classification, leaf precedence, compound verdicts, golden call replacement, escaping/order, metadata, graph ambiguity, explicit ambiguity context, invalid inputs and immutable inputs.

`tests/phase4-integration.test.cjs` executes the synthetic `test-projects/structural` handler through the real CLI and four-run harness. Eleven scenarios validate written Signatures, DiffReport and VerdictReport, including semantic ESCALATE, info-only PASS, and unstable INDETERMINATE. No synthetic data is placed in the provider fixture directory.

`pnpm coverage:differ` runs the pure suite with c8/V8 coverage remapped to TypeScript. `pnpm test` also enforces the same gate. `.c8rc.json` includes **all differ source files** and the core verdict resolver with a **90% per-file branch threshold** (and 90% lines/statements/functions). Reports are written to `.isotope/coverage/`; missing source files are included at zero coverage rather than excluded.
