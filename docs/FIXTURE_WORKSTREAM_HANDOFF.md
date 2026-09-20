# Isotope — Stripe Fixture Workstream Handoff

**For:** the Claude Code session continuing this work
**Repo:** `/Users/harrisonmartel/hophacksf26`
**Branch:** `fix/stripe-fixtures` (created off `81729f4`, tooling currently uncommitted)
**Companion document:** Isotope Master Technical Specification v3.0 — architectural source of truth
**Date:** 2026-09-19

---

## 0. Read this first

This workstream sits between Phase 3 and Phase 4:

```
PHASE 3 COMPLETE
      ↓
THIS WORKSTREAM  ← you are here, partially done
Real Stripe fixture capture + normalization + validation
      ↓
MERGE TO MAIN
      ↓
VERIFY CLEAN MAIN STATE
      ↓
PHASE 4 BEGINS (complete L4 structural differ)
```

**Do not begin Phase 4.** The Phase 4 start gate is not met.
**Do not modify `packages/differ/**`** except for a genuine unrelated regression.
**Do not add semantic reasoning or repair.**

The single most important rule in this workstream, from v3 §1.1 and the assignment §3:

> Everything Isotope verifies against is a **real payload produced by the provider**.
> Nothing is hand-authored, LLM-generated, or "mutated."

If you find yourself about to write Stripe JSON by hand, generate it with a model, or
tweak a captured payload so it matches the expected break — **stop**. That act invalidates
every number the product will later claim, and a judge will ask. Capture again instead.

---

## 1. Repository state

| Phase | Status |
|---|---|
| Phase 1 — contracts, artifact paths, CLI shell | complete |
| Phase 2 — first old/new behavioral vertical slice | complete |
| Phase 3 — reusable child-process harness | complete |
| **This workstream — real provider evidence** | **tooling complete, capture NOT performed** |
| Phase 4 — complete L4 structural differ | not started |

Baseline at `81729f4` (per `docs/PHASE3.md`, Node 20.20.2 / pnpm 9.15.9):

```
pnpm typecheck   passing
pnpm test        144 passing
pnpm build       passing
pnpm isotope --help   passing
```

Regression behaviour:

```
synthetic control     → PASS, exit 0
synthetic broken pair → FAIL, exit 1
observed: renewalDate 1700000123 → undefined
```

**Real-provider acceptance remains blocked.** `fixtures/raw/` and `fixtures/normalized/`
contain only `README.md`. No provider fixture has been fabricated. Preserve that honesty.

---

## 2. Why the previous session could not finish

The capture step needs the Stripe CLI, an authenticated test-mode session, network access
to `api.stripe.com`, and a process that stays alive long enough to receive a webhook.

| Environment | Stripe CLI | Route to Stripe | Long-lived listener |
|---|---|---|---|
| Claude cloud container | no | denied — `connect_rejected (organization policy)` | n/a |
| Desktop bridge shell (`device_bash`) | not installed | no — `curl` returns `000` | no, 180s per call |
| **Operator macOS terminal** | **yes** | **yes** | **yes** |

If you are Claude Code running on Harrison's Mac with his real shell, **you may well be
able to do the capture yourself** — that is the main thing that changed by migrating.
Check first:

```sh
which stripe && stripe --version
curl -s -o /dev/null -w '%{http_code}\n' https://api.stripe.com/v1/
```

If both work, run the runbook in `docs/STRIPE_FIXTURES.md` directly instead of handing it
back to the operator.

---

## 3. What already exists (built and tested, not yet committed)

Four files. All tests pass; the capture server was smoke-tested end to end.

### `tools/capture-server.js`

Minimal v3 §1.2 / §7 capture server. Zero dependencies.

```sh
node tools/capture-server.js --port 4242 --out fixtures/raw
```

- `POST /<label>` → writes the raw body **verbatim** to `fixtures/raw/<label>/<event>.<ts>.<sha8>.json`
- writes a `.meta.json` sidecar: version label, `receivedAt`, `Stripe-Signature`, payload
  `api_version`, event id/type, object id/type, `rawSha256`, byte count, `envelope: "provider"`
- refuses to overwrite an existing capture (raw evidence is append-only)
- never normalizes, reformats or reorders anything
- **prints per delivery** whether `current_period_end` is present at subscription level and
  at item level — this is the §10 verification, see §5 below

### `tools/normalize-fixtures.js`

v3 §1.5 / §13–§17 normalizer. Zero dependencies. Also exports its internals for testing.

```sh
node tools/normalize-fixtures.js \
  --pair sub-updated-single --role planning --namespace A --capture-method B \
  --old fixtures/raw/acacia/<file>.json \
  --new fixtures/raw/dahlia/<file>.json

node tools/normalize-fixtures.js --verify
```

Permitted operations, and nothing else:

1. record API/version metadata
2. replace provider identifiers with pair-scoped deterministic aliases
3. emit normalized JSON
4. record SHA-256 of each raw input

**The load-bearing guard is `assertOnlyAliased()`.** It re-walks raw against normalized and
refuses to write unless *every* difference is explained by the recorded alias map. It
rejects: inserted keys, removed keys, reordered keys, moved fields, changed numbers /
booleans / nulls, changed array lengths, changed array order, type changes, and any string
change the alias map does not account for.

Consequences worth internalising:

- **Timestamps are numbers, so they are never touched.** That is what keeps the held-out
  pair genuinely different from the planning pair (§11 of the assignment).
- **Key order and array order are preserved exactly** — output uses `JSON.stringify(v, null, 2)`
  over a parse that preserves insertion order, deliberately *not* `deterministicJson`
  (which key-sorts, and key-sorting raw evidence is a reshape).
- Alias namespaces are pair-scoped: `sub_A1` in the planning pair, `sub_B1` in held-out.
  The tool **refuses to reuse a namespace across pairs**, because a shared namespace would
  let a patch memorise a value from one pair and satisfy the other.
- Hard-fails if a raw payload matches `sk_live_`, `sk_test_`, `rk_*`, `whsec_`, `pk_live_`,
  or a GitHub token pattern. Stripe **test object IDs** are expected and fine.
- Refuses if both payloads report the same `api_version`.
- `--capture-method C` requires `--envelope synthetic` and records a
  `syntheticEnvelopeDisclosure` field. Never describe such a pair as provider-delivered.

`--verify` recomputes each raw SHA-256 against `meta.json` and re-checks that each
normalized file is still an alias-only transform of its raw input. It catches both a
tampered raw file and a hand-edited normalized file.

### `tests/fixtures.test.cjs`

12 tests, all passing. Every payload in the file is a synthetic **input** used to prove the
normalizer cannot reshape evidence; all CLI runs target a temporary `--out` root, so
nothing is ever written into `fixtures/raw` or `fixtures/normalized`.

Coverage: all nine reshape classes rejected; key/array order and scalar preservation;
alias consistency within a pair and distinctness across pairs; IDs embedded in URLs;
CLI round-trip with provenance; output determinism; tampered-raw detection; hand-edited-
normalized detection (specifically: restoring `current_period_end` in `new.json`);
namespace collision refusal; credential refusal; identical-api-version refusal.

### `docs/STRIPE_FIXTURES.md`

The operator runbook: CLI probe, method A/B/C decision tree, test-mode resource setup,
capture, held-out capture, normalization, provenance, secret scanning, and a capture
record table to fill in.

---

## 4. The Stripe CLI issue and its workaround

A prior session recorded Stripe CLI `1.51.0` returning `unknown flag: --api-version` on
ordinary **resource** commands. That says nothing about `stripe listen`, and nothing about
passing `api_version` as an API *parameter*.

Probe before choosing:

```sh
stripe --version
stripe listen --help | grep -i -- '--api-version'
stripe webhook_endpoints create --help 2>&1 | head -30
```

**Method A** — if `stripe listen` accepts `--api-version`, run two listeners pinned to
`2025-02-24.acacia` and `2026-08-26.dahlia`, both forwarding to the capture server on
distinct paths.

**Method B (recommended fallback, and the workaround for the known issue)** — `api_version`
is an ordinary API parameter, so `-d` reaches it even when the flag is unrecognised:

```sh
cloudflared tunnel --url http://localhost:4242

stripe webhook_endpoints create \
  -d url="https://<tunnel>/acacia" \
  -d api_version="2025-02-24.acacia" \
  -d "enabled_events[]=customer.subscription.updated"

stripe webhook_endpoints create \
  -d url="https://<tunnel>/dahlia" \
  -d api_version="2026-08-26.dahlia" \
  -d "enabled_events[]=customer.subscription.updated"

stripe webhook_endpoints list | grep -E 'api_version|url'
```

Still genuine provider delivery, so `envelope` stays `provider`.

**Method C (last resort)** — retrieve the same Subscription under two `Stripe-Version`
headers. Real objects, locally constructed envelope. Must be disclosed as synthetic.

**If Stripe rejects either version string**, that is a real finding. List what the account
accepts, pick the nearest pre-Basil and post-Basil versions, update the `versions` block in
`specs/stripe/basil-subscription-period.yaml`, and record the substitution. The pair must
still straddle the Basil period-field move.

---

## 5. The go/no-go you must not skip

v3 §10 / assignment §10: **verify what Stripe actually produced. Do not assume the break.**

The capture server prints, per delivery:

```
sub.current_period_end=<value|ABSENT> items=<n> item.current_period_end=[...]
```

The expected and desired result:

```
acacia:  sub.current_period_end=1700000123  items=1  item.current_period_end=[ABSENT]
dahlia:  sub.current_period_end=ABSENT      items=1  item.current_period_end=[1700000123]
```

**If Dahlia still carries a subscription-level `current_period_end`**, providers often keep
deprecated fields populated for backward compatibility — then:

- do **not** alter the payload;
- check whether the wrong endpoint, event or version was used, and correct the capture setup;
- otherwise **document the real finding** and raise it before proceeding.

The whole silent-break thesis depends on this one observation. It is cheap to check and
fatal to assume.

---

## 6. Remaining work, in order

### Step 1 — place and commit the tooling

The four files are attached alongside this document. Put them at:

```
tools/capture-server.js
tools/normalize-fixtures.js
tests/fixtures.test.cjs
docs/STRIPE_FIXTURES.md
```

Confirm they run:

```sh
node --test tests/fixtures.test.cjs     # expect 12 passing
pnpm typecheck && pnpm test && pnpm build
```

Expected total after adding: **144 + 12 = 156 passing**. `tools/` is not in
`tsconfig.check.json`, matching the existing `tools/export-schemas.cjs` CJS convention.
Note: the spec names this file `tools/normalize-fixtures.ts`; it is `.js` (CJS) to match
the established repo convention rather than introduce a second build path. Record that
deviation in `docs/STRIPE_FIXTURES.md` §7.

Commit: `capture: add raw Stripe capture server and fixture normalizer with provenance guards`

### Step 2 — capture the primary pair

Runbook §1–§3. One customer, one subscription, one subscription item, test mode only.
Perform the §5 go/no-go check above.

Commit: `fixtures: capture primary Acacia/Dahlia sub-updated-single pair`

### Step 3 — capture the held-out pair before dismantling anything

`sub-updated-single-B`: **different customer, different subscription, different billing
anchor and timestamps**, same contract scenario. Capture it while the tunnel and endpoints
are still live — rebuilding that setup later is the avoidable waste.

This pair exists so a repair that hardcodes a planning-pair value fails. If it shares pair
A's identifiers or timestamps it cannot do that job.

Commit: `fixtures: capture held-out sub-updated-single-B pair`

### Step 4 — optional extra pairs, only if quick

Priority: `sub-updated-noop`, `sub-updated-multi`, `sub-updated-aggregating`, `invoice-paid`.
**Do not let any of these block the Phase 4 handoff.**

Note: `fixtureVersion()` in `packages/cli/src/walking-skeleton.ts` currently hard-asserts
`type === 'customer.subscription.updated'`, so an `invoice-paid` pair will be rejected until
that check is relaxed. That is Phase 4+ work, not this workstream.

### Step 5 — normalize and verify

```sh
node tools/normalize-fixtures.js --pair sub-updated-single   --role planning --namespace A --capture-method B --old ... --new ...
node tools/normalize-fixtures.js --pair sub-updated-single-B --role held_out --namespace B --capture-method B --old ... --new ...
node tools/normalize-fixtures.js --verify
```

Commit: `fixtures: normalize provider captures with SHA-256 provenance`

### Step 6 — run the Phase 3 harness on real evidence

```sh
pnpm phase2:verify          # no ISOTOPE_TEST_FIXTURES — this is the product path
```

This reads `fixtures/normalized/sub-updated-single/` via `spec.fixtures.pair`. It should
now get past the `BLOCKER:` error in `walking-skeleton.ts`.

Record, from `examples/walking-skeleton/.isotope/`:

- old determinism (old0 vs old1) — must be stable
- new determinism (new0 vs new1) — must be stable
- old observable behaviour (`calls[0]` args to `db.subscription.update`)
- new observable behaviour
- the actual structural difference
- the current verdict and exit code

**Do not change L4 logic to accommodate the real result. Do not modify the
walking-skeleton handler to produce the expected break.** If the real pair produces
something the minimal differ classifies differently than the synthetic pair did, that is
precisely the Phase 4 starting point — document it, do not fix it.

### Step 7 — `docs/PHASE4_HANDOFF.md`

Write it only with **actual observed values**. Required sections:

- repository state (Phases 1–3 complete, provider evidence complete, Phase 4 not started)
- real fixture paths (both pairs, old and new)
- real Signature artifact paths
- the actual real-provider behavioural difference, with real values
- what the current minimal differ classifies, and what it leaves unclassified
- exact Phase 4 target: *complete L4 structural classification over trusted Signatures; do
  not modify fixtures or harness behaviour to make classification tests pass*
- known limitations

### Step 8 — regression, merge, verify clean main

```sh
pnpm typecheck && pnpm test && pnpm build
ISOTOPE_TEST_FIXTURES="$PWD/packages/harness-ts/test-fixtures/control" pnpm phase2:verify   # PASS, exit 0
ISOTOPE_TEST_FIXTURES="$PWD/packages/harness-ts/test-fixtures/broken"  pnpm phase2:verify   # FAIL, exit 1
node tools/normalize-fixtures.js --verify

git diff --cached
git grep -nE '(sk|rk|pk)_(live|test)_|whsec_|ghp_' -- . ':!docs/STRIPE_FIXTURES.md' ':!docs/*HANDOFF*'
```

Then merge `fix/stripe-fixtures` → `main`, and re-run typecheck / test / build on clean `main`.

---

## 7. Phase 4 start gate

Do not declare ready until every line is true:

```
REAL STRIPE PAIR CAPTURED            ☐
NORMALIZED WITHOUT RESHAPING         ☐
RAW PROVENANCE + SHA RECORDED        ☐
PHASE 3 HARNESS CONSUMES IT          ☐
OLD SELF-COMPARISON STABLE           ☐
NEW SELF-COMPARISON STABLE           ☐
REAL OLD/NEW SIGNATURES SAVED        ☐
PHASE 4 HANDOFF DOCUMENTED           ☐
TYPECHECK / TEST / BUILD GREEN       ☐
MERGED TO MAIN                       ☐
```

---

## 8. Out of scope

Phase 4 structural classification; AST resolver; automatic BDG; semantic reasoner;
Anthropic calls; Repair Planner; deterministic codemod; repair worktree; repair
verification; GitHub Action; Dependabot reporting; fleet dashboard; Python execution.

This workstream ends at: **real provider evidence successfully flowing through Phase 3.**

---

## 9. Useful repository facts

- `loadWalkingSkeletonSpec` now requires an explicit ChangeSpec ID, so compatibility
  tests remain deterministic when a registry contains multiple providers.
- `verifyWalkingSkeleton` resolves fixtures at `fixtures/normalized/<spec.fixtures.pair>`,
  i.e. only ever `sub-updated-single`. The held-out, multi, aggregating and noop pairs are
  named in the YAML but read by nothing yet.
- `fixtureVersion()` hard-asserts an `event` envelope of type
  `customer.subscription.updated` wrapping a `subscription` object, and requires the two
  `api_version` values to differ.
- `meta.synthetic === true` is the **internal test hook** and is forbidden in product
  fixture directories. Method C sets `envelope: "synthetic"` plus
  `syntheticEnvelopeDisclosure` — never `synthetic: true`.
- `tests/smoke.test.cjs` asserts `corpus/` contains only `README.md`. It will fail the
  moment a real corpus repo is cloned — a Phase 5+ concern, not this workstream's.
- `.isotope/` is gitignored, so generated Signatures are not committed. If the Phase 4
  handoff should ship inspectable real Signatures in-repo, copy them to a tracked path and
  say so in the handoff doc.
- Definition of success, to hand the next developer verbatim:

  > The execution engine is finished enough to trust, and the primary old/new evidence is
  > no longer synthetic. These are real Stripe test-mode payloads under the relevant API
  > contracts, their provenance is preserved, the Phase 3 harness produces stable
  > real-world Signatures from them, and Phase 4 can now focus exclusively on correctly
  > classifying those observed behavioral differences.
