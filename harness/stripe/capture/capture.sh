#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
command -v stripe >/dev/null
command -v cloudflared >/dev/null
test "${STRIPE_CAPTURE_CONFIRMED_TEST_MODE:-}" = "yes" || {
  echo "Set STRIPE_CAPTURE_CONFIRMED_TEST_MODE=yes only after confirming the active Stripe CLI account is the intended sandbox." >&2
  exit 2
}

echo "Capture orchestration intentionally requires an interactive operator for fresh object construction."
echo "Start: node $repo_root/tools/capture-server.js --port 4242 --out $repo_root/fixtures/raw"
echo "Then create temporary acacia/dahlia webhook endpoints through a cloudflared URL, trigger each required event, normalize, verify, secret-scan, and delete both endpoints."
echo "See $repo_root/harness/stripe/capture/RUNBOOK.md"
exit 3
