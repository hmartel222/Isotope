# Stripe fixture capture, normalization and provenance

Status: **tooling complete, capture not yet performed.**

This document is the reproduction runbook for the real-provider evidence required by
v3 §1.1–§1.6. It is written to be executed by a human operator on a machine that has
the Stripe CLI installed and authenticated in **test/sandbox mode**.

---

## 0. Why this is operator-run

The capture step cannot be performed from the Claude session that built this tooling:

| Environment | Stripe CLI | Route to `api.stripe.com` | Can hold a listener open |
|---|---|---|---|
| Claude cloud container | no | denied by egress policy (`connect_rejected`) | n/a |
| Desktop bridge shell (`device_bash`) | not installed | no (`curl` → `000`) | no — each call is a fresh 180s shell |
| **Operator macOS terminal** | **yes** | **yes** | **yes** |

Sections 1–5 below therefore run in your own terminal, from the repository root.

---

## 1. Probe the installed CLI before choosing a method

A previous session recorded Stripe CLI `1.51.0` rejecting `--api-version` on ordinary
**resource** commands (`unknown flag: --api-version`). That flag is a resource-command
flag in some builds and absent in others; it says nothing about `stripe listen` or about
passing `api_version` as an API parameter. Probe, do not assume:

```sh
stripe --version
stripe listen --help            | grep -i -- '--api-version'
stripe webhook_endpoints create --help 2>&1 | head -30
```

Record the output in §7 of this document.

---

## 2. Choose a capture method

Try in this order and stop at the first that works. Do not spend more than ~15 minutes
forcing an unsupported syntax.

### Method A — `stripe listen` pinned to two API versions (preferred)

Available only if the probe showed `--api-version` on `stripe listen`.

```sh
# terminal 1
node tools/capture-server.js --port 4242 --out fixtures/raw

# terminal 2
stripe listen --forward-to localhost:4242/acacia --api-version 2025-02-24.acacia

# terminal 3
stripe listen --forward-to localhost:4242/dahlia --api-version 2026-08-26.dahlia
```

### Method B — two webhook endpoints, each pinned, behind a tunnel (recommended fallback)

Even when `--api-version` is not a recognised *flag*, `api_version` is an ordinary API
*parameter*, so `-d` reaches it. This is the workaround for the known CLI issue:

```sh
# terminal 1
node tools/capture-server.js --port 4242 --out fixtures/raw

# terminal 2
cloudflared tunnel --url http://localhost:4242     # note the printed https URL

# terminal 3 — substitute the tunnel host
stripe webhook_endpoints create \
  -d url="https://<tunnel>/acacia" \
  -d api_version="2025-02-24.acacia" \
  -d "enabled_events[]=customer.subscription.updated"

stripe webhook_endpoints create \
  -d url="https://<tunnel>/dahlia" \
  -d api_version="2026-08-26.dahlia" \
  -d "enabled_events[]=customer.subscription.updated"
```

Confirm both endpoints report the version you asked for before triggering anything:

```sh
stripe webhook_endpoints list | grep -E 'api_version|url'
```

**If Stripe rejects either version string**, that is a real finding, not a thing to work
around. List what the account will actually accept, pick the nearest pre-Basil and
post-Basil versions, and record the substitution in §7. The ChangeSpec
(`specs/stripe/basil-subscription-period.yaml`) will need its `versions` block updated to
match, and the pair must still straddle the Basil period-field move.

Both endpoints are real Stripe delivery, so `envelope` stays `provider`.

### Method C — versioned object retrieval (last resort, discloses a synthetic envelope)

Only if versioned webhook delivery is genuinely blocked. Real Stripe **objects**, locally
constructed **envelope**:

```sh
curl -s https://api.stripe.com/v1/subscriptions/sub_XXX -u "$STRIPE_TEST_KEY:" \
  -H "Stripe-Version: 2025-02-24.acacia" > fixtures/raw/acacia/subscription.json
curl -s https://api.stripe.com/v1/subscriptions/sub_XXX -u "$STRIPE_TEST_KEY:" \
  -H "Stripe-Version: 2026-08-26.dahlia" > fixtures/raw/dahlia/subscription.json
```

Normalize with `--capture-method C --envelope synthetic`. The tool then records a
`syntheticEnvelopeDisclosure` field in `meta.json`. Never describe such a pair as
provider-delivered.

---

## 3. Create the minimum test-mode state

Test/sandbox mode only. Never a live key.

```sh
stripe customers create -d name="Isotope Planning A"
stripe prices create -d unit_amount=1000 -d currency=usd \
  -d "recurring[interval]=month" -d "product_data[name]=Isotope Fixture"
stripe subscriptions create -d customer=cus_... -d "items[0][price]=price_..."
```

One customer, one subscription, one subscription item. Nothing more.

Then trigger the event so Stripe renders it once per endpoint contract:

```sh
stripe subscriptions update sub_... -d "metadata[isotope]=capture"
# or: stripe trigger customer.subscription.updated
```

The capture server prints, per delivery, whether `current_period_end` is present at the
subscription level and at the item level. **Read that line.** It is the §10 verification,
and it is the go/no-go on the entire silent-break thesis. If Dahlia still carries a
subscription-level `current_period_end`, do not alter the payload — record the finding.

---

## 4. Capture the held-out pair before dismantling anything

While the tunnel and endpoints are still up, repeat §3 with a **different customer and a
different subscription**, created at a different time so the billing anchor and timestamps
genuinely differ.

The held-out pair exists to catch a repair that hardcodes a value from the planning pair.
If pair B shares pair A's identifiers or timestamps, it cannot do that job.

Optional, in priority order and only if time permits: `sub-updated-noop` (two adjacent
versions, no contract change), `sub-updated-multi` (two items), `sub-updated-aggregating`,
`invoice-paid`. Do not let any of these block the Phase 4 handoff.

---

## 5. Normalize

```sh
node tools/normalize-fixtures.js \
  --pair sub-updated-single --role planning --namespace A --capture-method B \
  --old fixtures/raw/acacia/customer.subscription.updated.<ts>.<sha>.json \
  --new fixtures/raw/dahlia/customer.subscription.updated.<ts>.<sha>.json

node tools/normalize-fixtures.js \
  --pair sub-updated-single-B --role held_out --namespace B --capture-method B \
  --old fixtures/raw/acacia/<held-out old>.json \
  --new fixtures/raw/dahlia/<held-out new>.json

node tools/normalize-fixtures.js --verify
```

### What normalization is allowed to do

1. record API/version metadata;
2. replace provider identifiers with pair-scoped deterministic aliases;
3. emit normalized JSON;
4. record the SHA-256 of each raw input.

### What it cannot do, and is mechanically prevented from doing

`assertOnlyAliased()` re-walks raw against normalized and refuses to write unless **every
single difference is explained by the recorded alias map**. Inserting, removing, moving or
reordering a field, changing any number, boolean or null, changing an array length, or
changing a string in any way the alias map does not account for all abort the run.

Timestamps are numbers, so they are never touched — which is exactly what keeps the
held-out pair genuinely different from the planning pair.

### Alias namespaces

Aliases are pair-scoped: `sub_A1` in the planning pair, `sub_B1` in the held-out pair.
The tool refuses to reuse a namespace across pairs, because a shared namespace would let a
patch memorise a value from one pair and satisfy the other.

---

## 6. Provenance and immutability

`fixtures/raw/**` is evidence. Never normalize in place, never run a formatter over it,
never hand-edit an identifier, never "correct" a field. If a capture is wrong, capture
again and leave the bad one or delete the directory — do not repair evidence.

`node tools/normalize-fixtures.js --verify` recomputes each raw SHA-256, compares it to
`meta.json`, and re-checks that each normalized file is still an alias-only transform of
its raw input. It fails loudly on a tampered raw file and on a hand-edited normalized file.

### Secrets

The normalizer hard-fails if a raw payload matches `sk_live_`, `sk_test_`, `rk_*`,
`whsec_`, `pk_live_`, or a GitHub token pattern. Stripe **test object IDs** in raw payloads
are expected and fine; credentials are not. Before committing:

```sh
git diff --cached
git grep -nE '(sk|rk|pk)_(live|test)_|whsec_|ghp_' -- . ':!docs/STRIPE_FIXTURES.md'
```

---

## 7. Capture record — fill in after running

| Field | Value |
|---|---|
| Stripe CLI version | _pending_ |
| Mode | test / sandbox (never live) |
| `stripe listen --api-version` supported | _pending_ |
| Capture method used | _pending (A / B / C)_ |
| Old API version | _pending_ |
| New API version | _pending_ |
| Event type(s) | `customer.subscription.updated` |
| Tunnel used | _pending_ |
| Raw paths | _pending_ |
| Normalized paths | _pending_ |
| Observed: old `current_period_end` placement | _pending_ |
| Observed: new `current_period_end` placement | _pending_ |
| Tooling limitations encountered | _pending_ |

Never record API keys, webhook secrets, CLI session material or tunnel credentials here.
