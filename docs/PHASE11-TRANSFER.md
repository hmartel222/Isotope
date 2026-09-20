# Phase 11 transfer — LLM Repair Planner (L8)

This is the handoff for the next agent. Read it before editing. The [v3 specification](../docs-v3-spec.md) remains the architectural source of truth. Do not begin Phase 12 (fleet / accuracy / extra adapters). Do not redesign working L1–L4, L5, L6, L9, or L10.

Phase 11 is: **given a proven incompatibility that deterministic rules cannot repair, assemble a bounded RepairPacket from already-trusted artifacts, ask a bounded planner for anchored edits, apply those edits only in an ephemeral workspace, and let the existing L10 verifier decide whether the patch is real.**

The model proposes. L10 verifies. Candidates have no authority.

---

## 1. How to use this file

1. Skim §2–§4 (trust rules and current pipeline).
2. Treat §5 as the map of the repo as it exists after Phase 10.
3. Treat §6–§8 as the Phase 10/9 surfaces you must reuse, not rewrite.
4. Implement only §9.
5. Obey §10 (do not implement).
6. Start at the seams in §11.

Prior phase audits (do not contradict them):

- [docs/CONTRACTS.md](CONTRACTS.md)
- [docs/PHASE3.md](PHASE3.md) … [docs/PHASE10.md](PHASE10.md)
- [docs/PHASE9.md](PHASE9.md) — L7/L9/L10 deterministic loop already exists
- [docs/PHASE10.md](PHASE10.md) — L5/L6 reasoned verdicts already exist

---

## 2. Product thesis (do not weaken)

Isotope traces a **human-verified provider ChangeSpec** through application code, compares isolated old/new execution, and offers a repair only after independent verification against:

- the original application under the **old** provider contract (immutable baseline)
- a **held-out** fixture the proposer never saw

It runs in the customer’s runner. No hosted service. No commit, push, branch, PR, or merge. The customer checkout is never patched.

Trust hierarchy, always:

```
provider evidence
  → static provenance (BDG)
  → execution evidence (signatures)
  → deterministic diff
  → semantic reasoning
  → repair proposal          ← Phase 11 adds this
  → independent verification ← already exists; do not weaken it
```

Non-negotiable:

- Mechanical `FAIL` is unappealable. No reasoner or planner may clear a proven break or bless its own patch.
- `ESCALATE` means a human decision. Never ask a model to invent business policy.
- Absence of evidence is not evidence of a safe patch.
- Held-out fixtures, signatures, identifiers, and verification results must never enter a planner packet.
- A `CandidatePatch` is a hypothesis. Only L10 can produce `VerifiedRepair`, and it is always `offeredOnly: true`.

---

## 3. What is already complete

| Phase | What landed |
| --- | --- |
| 1 | Monorepo, TypeBox contracts, schemas, artifact I/O, CLI scaffold |
| 2 | First TS behavioral verification slice |
| 3 | Isolated child-process harness, mocks, determinism, egress block |
| 4 | Pure structural differ + mechanical L6 subset |
| 5 | Real TS/JS resolver and BDG |
| 6 | Git dependency detection + human-verified ChangeSpec selection |
| 7 | Five-case detection matrix: FAIL / PASS / SKIP / ESCALATE |
| 8 | GitHub Action + PR reporter |
| 9 | Deterministic `path_rename` repair, ephemeral apply, held-out L10 |
| 10 | L5 evidence packets, two-vote reasoner, `PASS_REASONED` / `FAIL_REASONED` |

**Not done:** L8 model planner, Python, fleet, accuracy benchmarks, extra framework adapters, real-provider fixture capture.

Real-provider acceptance is still blocked: `fixtures/normalized/sub-updated-single/{old,new,meta}.json` is absent. Corpus fixtures under `corpus/cases/fixtures/` are explicitly synthetic (`meta.synthetic: true`) and must never be treated as Stripe-produced evidence.

---

## 4. Live pipeline after Phase 10

```
L1 select ChangeSpecs
  → L2 BDG
  → L3 isolated old/new execution (×2 each)
  → L4 structural diff
      ├── mechanical critical/high     → FAIL            MODEL NEVER CALLED
      ├── exact / info-only            → PASS
      └── semantic residual
            → eligibility gate
            → bounded EvidencePacket
            → vote A + vote B (+ one schema retry)
            → consensus
                  ├── incompatibility  → FAIL_REASONED
                  ├── benign_adaptation (medium+) → PASS_REASONED
                  └── anything else    → ESCALATE

FAIL              → existing deterministic codemod if safe_when
                    → else planner not yet implemented
FAIL_REASONED     → requires L8; currently no repair
ESCALATE          → no repair
PASS_REASONED     → no repair
```

CLI exits: `PASS`/`PASS_REASONED` 0, `FAIL`/`FAIL_REASONED` 1, `ESCALATE` 3, `INDETERMINATE` 4, `FAIL` with verified repair 5, bad args/config 10, unimplemented commands 12.

PR-level precedence (implemented in `packages/core/src/verdict.ts`):

`FAIL > FAIL_REASONED > ESCALATE > INDETERMINATE > PASS_REASONED > PASS > SKIP`

---

## 5. Repo map

pnpm workspace of `packages/*`. Core has **no** subsystem dependency.

| Package | Role now |
| --- | --- |
| `@isotope/core` | Schemas, artifact paths/I/O, L6 `resolveVerdict` / `resolveAggregateVerdict` |
| `@isotope/changespec` | Loads the known Stripe Basil spec; L1 selection |
| `@isotope/resolver-ts` | Bounded BDG |
| `@isotope/harness-ts` | Isolated execution |
| `@isotope/differ` | Pure L4 |
| `@isotope/reasoner` | L5 eligibility, packet, two votes, cache, Gemini adapter |
| `@isotope/repair` | Deterministic eligibility, `path_rename`, ephemeral apply. `planRepair` **throws** |
| `@isotope/verifier` | Re-entrant L10. Already calls L5 if patched behavior is semantic. Accepts `PASS_REASONED` as baseline-equivalent |
| `@isotope/reporter` | PR comment / check. `FAIL_REASONED` currently says planner unavailable |
| `@isotope/cli` | Orchestrates verify / matrix / deterministic repair |
| `action/` | Bundled Node 20 Action; `reasoner` and `repair` inputs exist |
| `@isotope/resolver-py`, `harness-py`, `fleet` | Stubs |

**Package-graph constraint (tests/smoke.test.cjs):** only `cli` and `verifier` may depend on other `@isotope/*` packages. `repair` currently depends on `@isotope/core` plus `ts-morph`. If the planner needs reasoner helpers, either:

- duplicate a narrow slice/adapter inside `repair`, or
- extract a tiny shared module, or
- update the smoke graph test to allow `repair → reasoner` the same way `verifier → reasoner` is allowed.

Do not casually create `repair → reasoner` without updating that test. Do not invert the graph so core depends on repair/reasoner.

Authoritative contracts: `packages/core/src/contracts.ts`. JSON Schema snapshots are generated by `pnpm build`; edit TypeBox, never snapshots.

---

## 6. Phase 10 (most recent) — what you must preserve

### Eligibility

Pure helper: `evaluateReasoningEligibility` in `packages/reasoner/src/eligibility.ts`.

L5 is invoked only when all are true: semantic-tier divergence, site confidence high/medium, sink not log_only-only, signatures stable, **no mechanical critical/high**, `reasoner.mode == on`, API key available, invocation budget ≥ 2, packet fits limits.

Anything mechanical / critical or high → `FAIL`, **zero** reasoner calls. Mixed mechanical + semantic still bypasses the model. Regression: `tests/phase10-reasoner.test.cjs` (“mechanical FAIL never calls the reasoner”).

### Grouping

One EvidencePacket per **entry point**, not per leaf divergence. Primary id = lexicographically first semantic divergence id; all member ids stay on `packet.diff`. Documented in `docs/PHASE10.md`.

### Packet construction

`packages/reasoner/src/packet.ts`

- Reconstruct from ChangeSpec + BDG + signatures + diff + bounded source reads
- Primary slice ≤ 200 lines, prefer enclosing function; overflow → escalate, do not mutilate
- ≤ 3 downstream functions, ≤ 80 lines, causal proximity from existing BDG (no new open-ended discovery)
- Signatures: diverging call ± 2 neighbors; `durationMs` zeroed for stable hashing
- Payload fragments from `removedPath` / `replacement.path` / item length; never whole webhook
- ChangeSpec `semantics` copied verbatim (do not verdict-prime)
- Ambiguity hint is `{ when, satisfied, question }`. Frozen packet schema has **no** `options` field; options remain on the ChangeSpec
- Held-out repair fixtures never mixed into detection packets
- Token estimator: `ceil(chars / 3)` in `packages/reasoner/src/tokens.ts`. Mode is `conservative-estimate`. Target 12k, hard cap 20k **estimated**, not Anthropic tokenizer. Cap exceeded after shrink → escalate
- Shrink order: drop least-relevant downstream slices → neighboring non-diverging calls → nonessential graph detail. Never drop ChangeSpec semantics, primary slice, divergence, or relevant sink
- Canonical JSON → SHA-256 `packetHash`

### Votes

`packages/reasoner/src/reason.ts`, `consensus.ts`, `validate.ts`, `prompt.ts`, `adapter.ts`, `cache.ts`

- Default model id: `gemini-3.6-flash` (`DEFAULT_REASONER_MODEL`)
- SDK: `@google/generative-ai`. Temperature 0. 30s timeout. No tools
- Narrow `SemanticModel { classify(input): Promise<string>; modelId }`
- Prompt version `REASONER_PROMPT_VERSION = 1`. Evidence only inside `<evidence>`
- Two independent votes; one mechanical schema retry (`primaryVotes = 2`, `apiAttempts <= 3`). Retry does not see the other vote
- Local schema + packet-relative `evidenceRefs` validation is product authority, not the API
- `confidence: low`, `abstain`, `suspectedInjection`, disagreement, timeout, missing key → `ESCALATE`
- Cache under `.isotope/cache/` keyed by `packetHash|model|promptVersion|schemaVersion`. Do not cache timeouts/malformed/network errors
- `maxInvocations` is PR-level; remaining semantic cases escalate with `invocation_cap_exceeded`

### L6

`packages/core/src/verdict.ts` does **not** read reasoning/config on mechanical FAIL (tested with throwing getters).

### Integration

- Verify path: `packages/cli/src/walking-skeleton.ts` calls `reasonAboutEntryPoint` when `needsSemanticReasoning && mode === 'on'`
- CLI `--no-reasoner` forces off; otherwise config wins. Action default `reasoner: off`
- Credentials: walking-skeleton uses `assumeCredentials ?? (semanticModel ? true : credentialsAvailable())`. Env: `GEMINI_API_KEY`, `INPUT_GEMINI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, or `GOOGLE_API_KEY`
- L10 `packages/verifier/src/index.ts` already reuses the same L5 if patched baseline-diff is semantic. `verifyRepair` still **requires original mechanical FAIL** (`originalVerdict.verdict !== 'FAIL'` throws). Phase 11 must extend this if a reasoned incompatibility is to be verified after a planner patch — the original verdict for that path is `FAIL_REASONED`, not `FAIL`

### Tests / corpus added in Phase 10

Cassettes in `tests/cassettes/reasoner/`:

- `benign-adaptation.json`, `incompatibility.json`, `human-decision.json`
- `disagreement.json`, `low-confidence.json`, `abstain.json`, `injection.json`
- `schema-failure.json`, `api-unavailable.json`

Corpus (not in the Phase 7 matrix):

- `corpus/cases/repositories/semantic-incompat` — `items.data[0].current_period_end` + multi fixture → semantic residual, cassette `FAIL_REASONED`, no deterministic repair
- `corpus/cases/repositories/human-policy` — same `[0]` access used as a human-decision cassette host → `ESCALATE` (planner must never run)

Phase 7 matrix stays reasoner-off, so `ambiguity-escalate` remains `ESCALATE` with `semantic_reasoner_unavailable`. Do not “fix” the matrix by turning the reasoner on unless you also change expected verdicts.

Aggregation / benign live path in tests: `ambiguity-escalate` + `corpus/cases/fixtures/sub-updated-multi` + Math.max handler.

---

## 7. Phase 9 loop Phase 11 plugs into (do not rebuild)

Already working for mechanical `FAIL`:

1. `evaluateRepairEligibility` (`packages/repair/src/index.ts`) — pure; requires `verdict === 'FAIL'` today
2. `generateDeterministicCandidate` — ts-morph `path_rename` at BDG sites
3. `withAppliedCandidate` — detached git worktree or bounded copy; never patches checkout; `finally` cleanup
4. `verifyRepair` — rebuild BDG, original-old vs patched-new, secondary patched-old vs patched-new, held-out pair, shape checks
5. Success → `.isotope/repair/verified-repair.json`, exit 5, product verdict remains `FAIL`

Eligibility already encodes:

- `repair.verify` must be `true`
- exactly one ChangeSpec, distinct `heldout_pair`
- high/medium sites only
- **business_policy_required_when before `safe_when`**
- tiny predicate language: `always`, property paths including `.length`, integer comparisons, `&&`. YAML is never `eval`’d
- if no `path_rename` and `planner === 'model'` → `route: 'model'` but `eligible: false` with `planner_unavailable_in_current_build`

Application already rejects: traversal, symlinks, `.github/**`, lockfiles, `package.json`, `specs/**`, `.git/**`, `isotope.yml`, secrets-ish names, allow-list misses, duplicate/missing anchors, file/line budget.

L10 shape checks: provider→sink preserved, sinks preserved, no baseline literal introduced, taint root reachable, no new `as any` / ts-ignore.

Orchestration: `packages/cli/src/repair-flow.ts` `attemptDeterministicRepair`. Walking-skeleton only calls it when `result.verdict === 'FAIL'`.

Reporter already offers verified diffs for mechanical FAIL and suppresses rejected candidate code.

---

## 8. Frozen schemas Phase 11 must fill, not invent

`RepairPacket` already exists (`packages/core/src/contracts.ts`):

- `repairPacketVersion: 1`
- `change.knownSafeCodemod` nullable
- `verdict.type` is `FAIL` | `FAIL_REASONED` plus `causalExplanation` / `affectedBehavior`
- `execution.baselineSignature` and `newSignature` both `codeVersion: "original"`
- runtime invariant: both signatures share the same **planning** fixture pair (`packages/core/src/validation.ts`)
- constraints: `allowedPaths` 1–3 unique, `maxFiles` 1–3, `maxChangedLines` 1–80

`CandidatePatch` already distinguishes:

- `origin: deterministic | model`
- `repair_candidate` with nonempty anchored edits
- `human_decision_required` / `no_safe_repair` with `patch: null`

`VerifiedRepair` already allows `PASS_REASONED` on planning and held-out pairs. Do not loosen shape checks to make the planner look good.

Artifact paths already reserved:

```
.isotope/repair/packets/<repairId>.json
.isotope/repair/candidates/<repairId>.json
.isotope/repair/proposals/<repairId>.json
.isotope/repair/verification/<repairId>.json
.isotope/repair/verified-repair.json
```

Config already has `repair.planner: model | deterministic-only`, `selfConsistency`, `maxAttempts: 1`, `redact`.

---

## 9. Phase 11 objective (implement this)

v3 §3.8.3 routing after Phase 11:

```
FAIL ──┬── ChangeSpec path_rename, safe_when true ──→ existing deterministic CandidatePatch
       └── otherwise ───────────────────────────────→ L8 planner

FAIL_REASONED ───────────────────────────────────────→ L8 planner   (never the path_rename shortcut
                                                                      just because a codemod exists)

ESCALATE / PASS / PASS_REASONED / INDETERMINATE / SKIP → no repair, no model
```

Planner task (v3 §3.9): smallest behavior-preserving modification using documented new semantics and intent demonstrable from code/dataflow. Classifications:

| Classification | Meaning |
| --- | --- |
| `repair_candidate` | Specific anchored patch derivable from evidence |
| `human_decision_required` | Several plausible repairs; business policy |
| `no_safe_repair` | Understood, but not enough evidence to edit safely |

Hard constraints (reject before apply, no exceptions):

- ≤ `repair.maxFiles` (default 3), ≤ `repair.maxChangedLines` (default 80)
- allow-list = BDG affected files only
- forbidden paths as Phase 9 already implements
- 1 primary attempt; **1 retry only for mechanical parse/apply failure**, never for semantic rejection
- no tools, no shell, no filesystem, no GitHub API
- temperature 0 if the current Sonnet 5 API accepts it; otherwise omit (same rule as L5)
- `repair.selfConsistency: true` → two planner calls; materially different patches → escalate
- `confidence: low`, `abstain`, `suspectedInjection`, schema failure after one retry, timeout/API error → escalate, never silent PASS, never unverified patch

Edits are **anchor/replacement**, not whole-file writes. Anchor must match exactly once.

Reuse L9/L10 unchanged for application and verification. A planner candidate may verify as `PASS` or `PASS_REASONED` using the same L10 standard. Do not weaken held-out or shape checks.

v3 acceptance to aim for:

- **corpus-coord** (does not exist yet): coordinated helper-function incompatibility → `FAIL_REASONED` → planner → ephemeral apply → L10 → verified repair offered. Closest existing seed: `semantic-incompat`
- **corpus-multi / human-policy**: no patch generated, `ESCALATE`; planner never invents which item period to use
- Mechanical `FAIL` with `safe_when` still takes the Phase 9 deterministic path (exit 5). Do not send those through the model
- Offline planner cassettes, analogous to `tests/cassettes/reasoner/`
- Live Sonnet only if `ANTHROPIC_API_KEY` is present; otherwise complete offline/cassette work and report live L8 as blocked

Reporter: stop saying “planner unavailable” once L8 exists. Keep `FAIL_REASONED` red until a verified repair is offered. Verified reasoned repair should still keep the original incompatibility blocking (exit 5 / red check), same as Phase 9.

---

## 10. Do not implement in Phase 11

- Recursive “keep trying until tests pass”
- Model-written files, tools, or shell
- Sending the whole repo / `node_modules` / lockfiles / git history / env / secrets / held-out fixtures to the planner
- Letting the planner patch a mechanical `FAIL` that already has a safe deterministic codemod
- Letting the planner run on `ESCALATE` / `PASS_REASONED` / `INDETERMINATE`
- Skipping L10 or treating `CandidatePatch` as verified
- Committing, pushing, opening PRs, merging
- Python repair, fleet dashboard, ChangeSpec drafting, accuracy benchmark
- Redesigning L1–L4, L5 consensus, or L10 anti-cheat

---

## 11. Seams to start at (smallest change)

1. **Audit, don’t redesign.** Run `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm isotope matrix` first. Record baseline: mechanical FAIL, semantic ESCALATE (reasoner off), deterministic verified repair, cassette `FAIL_REASONED` with zero repair.
2. Extend `evaluateRepairEligibility` so `FAIL_REASONED` can return `route: 'model'` when `repair.planner === 'model'`, credentials exist, and ESCALATE/policy/low-confidence bypasses still hold. Keep `FAIL` + satisfied `safe_when` on `route: 'deterministic'`.
3. Implement `planRepair(input: RepairPlanInput)` instead of the throw in `packages/repair/src/index.ts`.
4. Build `RepairPacket` from existing artifacts only. Reuse Phase 10 slicing/redaction/budget ideas; do not send more than L5 already would. Include reasoner `causalExplanation` when the verdict is `FAIL_REASONED`. Assert held-out identifiers cannot appear in the serialized packet.
5. Wire walking-skeleton / `repair-flow.ts`: after L6, if deterministic-eligible → existing path; else if model-eligible → planner → same `withAppliedCandidate` + `verifyRepair`.
6. Relax `verifyRepair`’s `originalVerdict.verdict !== 'FAIL'` guard to accept `FAIL_REASONED` for model-origin candidates without weakening any check.
7. Cassettes + a coordinated-edit corpus case. Standard tests must not require a live key.
8. Update reporter copy and Action docs. Keep Action `repair` default off.

Likely files:

- `packages/repair/src/index.ts` (split if it gets large: eligibility stays pure)
- `packages/cli/src/repair-flow.ts`, `walking-skeleton.ts`
- `packages/verifier/src/index.ts` (original-verdict guard only)
- `packages/reporter/src/index.ts`
- `packages/core/src/stages.ts` if planner run metadata is needed
- `tests/phase11-planner.test.cjs` (new), `tests/cassettes/planner/`
- `docs/PHASE11.md` when done

---

## 12. Environment and test gotchas

- Manifest engines: Node **20.x**, pnpm **9.15.9**. Current agent machines may be Node 24; nested `pnpm` scripts then fail `engine-strict`. Use `pnpm --config.engine-strict=false` or run `tsc -b` / `c8 node --test` directly. Nested `pnpm test` → `pnpm build` does **not** inherit the flag.
- `tests/phase3.test.cjs` hang-kill uses `process.kill(-pid)` and can `EPERM` in restricted environments. That is not a Phase 10/11 product bug; do not “fix” it by weakening harness isolation.
- Last Phase 10 run: typecheck pass; matrix 5/5; offline tests 320 pass / 1 skip (no `ANTHROPIC_API_KEY`) / 1 env `EPERM`. Live L5 blocked. Do not claim a live model result without a key.
- Action bundle (`tools/build-action.mjs`) now includes reasoner + Anthropic + ts-morph. Planner will grow it further. `tests/phase8-action.test.cjs` ignores Node punycode deprecation on stderr.
- Isolated repair worktrees do **not** get a writable `node_modules` symlink (Phase 9 hardening). Stripe corpus works because the harness aliases `stripe` and local files are copied into the worktree.
- `exactOptionalPropertyTypes` is on. Do not pass `field: undefined`; omit the key.
- Recursive TypeBox `JsonValue` can appear as “two different types” across project references. Phase 10 used `unknown` payloads at the reasoner/verifier boundary for that reason.

---

## 13. Definition of success for Phase 11

Phase 11 succeeds when:

1. A `FAIL_REASONED` incompatibility with no safe `path_rename` can produce a bounded planner proposal.
2. That proposal is applied only ephemerally and independently verified by the existing L10 loop.
3. Mechanical `FAIL` with a safe codemod still uses the deterministic path and never calls the planner.
4. `ESCALATE` / human-policy / injection / low confidence / API outage never become a patch.
5. Held-out evidence never appears in the RepairPacket.
6. Offline cassettes cover the planner without an API key.
7. L10 is not compromised to make the planner look good.

Stop there. Do not start fleet, Python, or accuracy work.

---

## 14. Suggested first message to yourself

> Implement Phase 11 from `docs/PHASE11-TRANSFER.md` and v3 §3.8–3.11. Audit first. Do not redesign L1–L10 detection/verification. Reuse Phase 9 apply+verify. Planner is L8 only. Mechanical FAIL with safe_when stays deterministic. FAIL_REASONED never takes the path_rename shortcut. ESCALATE never calls the planner. Held-out stays out of the packet. Finish when typecheck/test/matrix/action:build are green offline; live Sonnet only if a key exists.
