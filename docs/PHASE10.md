# Phase 10 — semantic reasoning and reasoned verdicts

Phase 10 adds L5 without weakening L1–L4 or Phase 9 repair. Mechanical critical/high divergences still resolve to `FAIL` before any evidence packet is built; the model is not asked whether a proven break counts as a break.

## Grouping

One reasoning case is built per entry point. All `semantic_question` divergences for that entry are included in a single `EvidencePacket`. The artifact id is the lexicographically first semantic divergence id; member ids remain on `packet.diff`. This spends two independent votes on the affected behavior, not on every leaf integer.

## Packet and budget

Packets are reconstructed from the selected ChangeSpec, BDG, signatures, diff, and bounded source slices. Held-out repair fixtures are never mixed into detection packets. Token accounting uses a conservative local estimator (`ceil(chars / 3)`); the 20k hard cap is estimated, not an exact Gemini tokenizer count. Overflow after reductions escalates. The frozen `EvidencePacket` ambiguity hint carries `when`, `satisfied`, and `question`; ChangeSpec `options` remain on the spec rather than being duplicated into the packet schema.

## Votes

Default model: `gemini-3.6-flash`. Two independent votes share the packet and prompt (`REASONER_PROMPT_VERSION = 1`). One malformed vote may receive a single mechanical schema retry (`primaryVotes = 2`, `apiAttempts <= 3`). Cache keys include packet hash, model, prompt version, and schema version. Timeouts, missing keys, disagreement, low confidence, abstention, and suspected injection escalate. `PASS_REASONED` requires two medium-or-higher `benign_adaptation` votes. The v3 "two calls + one schema retry" rule is implemented as two independent primary votes with at most one mechanical format retry (`primaryVotes = 2`, `apiAttempts <= 3`). The retry asks only for schema-valid JSON over the same packet and never sees the other vote. Live calls read `GEMINI_API_KEY`.

## Verdicts

L6 ordering is unstable → mechanical FAIL → reasoned incompatibility → escalate/unavailable → reasoned benign adaptation → info/identical PASS. PR-level precedence is `FAIL > FAIL_REASONED > ESCALATE > INDETERMINATE > PASS_REASONED > PASS > SKIP`. Deterministic repair remains the mechanical-`FAIL` `path_rename` path. `FAIL_REASONED` may enter the Phase 11 planner when configured; it still does not take the Phase 9 codemod shortcut.
