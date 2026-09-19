# Stripe test-mode capture runbook

Prerequisites: authenticated Stripe CLI in the intended sandbox, `cloudflared`, Node 20, and no live-mode credential. Run `capture.sh`; it starts the local capture server and tunnel, creates version-pinned temporary webhook endpoints, triggers fresh test-mode objects/events, waits for both renderings, normalizes from raw, verifies every pair, scans for credential patterns, and deletes temporary endpoints in its cleanup trap.

Never edit captured or normalized JSON. If observed provider behavior contradicts a case, change the case and record the observation.

The 2026-09-19 run captured all required pairs. For `sub-updated-multi` and `sub-updated-aggregating`, the yearly item was second and its period end exceeded item zero; the old subscription-level value equaled item zero. The no-op pair used adjacent post-Basil versions (`2026-07-29.dahlia` and `2026-08-26.dahlia`). The paid-invoice pair verified the subscription id moved from `invoice.subscription` to `invoice.parent.subscription_details.subscription`.

`capture.sh` accepts the exact trigger as an argument array. Use `stripe trigger ...` for standard fixtures or a reviewed helper script for fresh multi-item resources; it starts the local receiver and tunnel, creates both version-pinned endpoints, runs the trigger, locates both deliveries, normalizes, verifies, scans, and deletes the endpoints in its cleanup trap.
