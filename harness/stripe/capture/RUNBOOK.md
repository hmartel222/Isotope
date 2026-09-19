# Stripe test-mode capture runbook

Prerequisites: authenticated Stripe CLI in the intended sandbox, `cloudflared`, Node 20, and no live-mode credential. Run `capture.sh`; it starts the local capture server and tunnel, creates version-pinned temporary webhook endpoints, triggers fresh test-mode objects/events, waits for both renderings, normalizes from raw, verifies every pair, scans for credential patterns, and deletes temporary endpoints in its cleanup trap.

Never edit captured or normalized JSON. If observed provider behavior contradicts a case, change the case and record the observation.

Required outstanding pairs: `sub-updated-multi`, `sub-updated-aggregating` (yearly item second and max different from item zero), `sub-updated-noop` (adjacent versions verified against the changelog), and `invoice-paid`.
