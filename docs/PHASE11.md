# Phase 11 — bounded LLM repair planner (L8)

Phase 11 adds a planner for proven incompatibilities that deterministic `path_rename` cannot repair. The model proposes anchored edits from a bounded `RepairPacket`. Existing L9 application and L10 verification remain the only authority that can produce `VerifiedRepair`.

## Routing

- Mechanical `FAIL` with a satisfied `safe_when` `path_rename` still uses the Phase 9 deterministic candidate. The planner is not asked to reinvent that edit.
- Mechanical `FAIL` without a safe codemod, and every `FAIL_REASONED`, may enter L8 when `repair.planner` is `model` and credentials exist.
- `ESCALATE`, `PASS`, `PASS_REASONED`, `SKIP`, and `INDETERMINATE` never call the planner. Business-policy predicates still bypass repair before any model call.

## RepairPacket

Packets are reconstructed from the selected ChangeSpec, BDG, planning signatures, structural diff, and the same bounded source slices used by L5. Held-out fixture identifiers and payloads are asserted absent from the serialized packet. `execution.baselineSignature` is original code under the old contract; `execution.newSignature` is original code under the new contract. ChangeSpec semantics are copied verbatim.

## Planner

Default model: `gemini-2.5-flash`. Prompt version `PLANNER_PROMPT_VERSION = 1`. No tools, filesystem, or shell. One primary attempt and one mechanical schema/apply retry. `repair.selfConsistency` runs two independent calls and escalates when normalized patches differ. Low confidence, abstain, injection, timeout, and API errors produce no patch. Live calls read `GEMINI_API_KEY`.

Classifications are `repair_candidate`, `human_decision_required`, and `no_safe_repair`. Origin is always `model`. L10 accepts `FAIL` or `FAIL_REASONED` as the original verdict for model candidates without changing held-out or shape checks.

## Acceptance

Offline cassettes live in `tests/cassettes/planner/`. `corpus/cases/repositories/corpus-coord` is the coordinated helper+caller hero case. The Phase 7 detection matrix stays reasoner-off and repair-off. Planner acceptance is `tests/phase11-planner.test.cjs`.
