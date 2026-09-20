#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
port="${STRIPE_CAPTURE_PORT:-4242}"
usage() {
  cat >&2 <<'EOF'
Usage: capture.sh PAIR ROLE NAMESPACE OLD_LABEL OLD_VERSION NEW_LABEL NEW_VERSION EVENT -- TRIGGER [ARGS...]

Example:
  STRIPE_CAPTURE_CONFIRMED_TEST_MODE=yes capture.sh invoice-paid auxiliary F \
    acacia 2025-02-24.acacia dahlia 2026-08-26.dahlia invoice.payment_succeeded -- \
    stripe trigger invoice.payment_succeeded

The trigger may be a checked-in helper that creates a fresh custom test object.
It is executed as an argument array; shell strings and eval are unsupported.
EOF
  exit 2
}

test "$#" -ge 10 || usage
pair="$1"; role="$2"; namespace="$3"; old_label="$4"; old_version="$5"
new_label="$6"; new_version="$7"; event="$8"; shift 8
test "$1" = "--" || usage
shift
test "$#" -gt 0 || usage
for dependency in stripe cloudflared jq node curl; do command -v "$dependency" >/dev/null; done
test "${STRIPE_CAPTURE_CONFIRMED_TEST_MODE:-}" = "yes" || {
  echo "Set STRIPE_CAPTURE_CONFIRMED_TEST_MODE=yes only after confirming the active Stripe CLI account is the intended sandbox." >&2
  exit 2
}

work="$(mktemp -d "${TMPDIR:-/tmp}/isotope-stripe-capture.XXXXXX")"
server_pid=""; tunnel_pid=""; old_endpoint=""; new_endpoint=""
cleanup() {
  set +e
  test -z "$old_endpoint" || stripe webhook_endpoints delete "$old_endpoint" --confirm >/dev/null
  test -z "$new_endpoint" || stripe webhook_endpoints delete "$new_endpoint" --confirm >/dev/null
  test -z "$tunnel_pid" || kill "$tunnel_pid" 2>/dev/null
  test -z "$server_pid" || kill "$server_pid" 2>/dev/null
  rm -rf "$work"
}
trap cleanup EXIT INT TERM

cd "$repo_root"
node tools/capture-server.js --port "$port" --out fixtures/raw >"$work/server.log" 2>&1 &
server_pid="$!"
for _ in $(seq 1 50); do curl -fsS "http://127.0.0.1:$port/health" >/dev/null 2>&1 && break; sleep .1; done
curl -fsS "http://127.0.0.1:$port/health" >/dev/null

cloudflared tunnel --url "http://127.0.0.1:$port" --no-autoupdate >"$work/tunnel.log" 2>&1 &
tunnel_pid="$!"
for _ in $(seq 1 100); do
  tunnel_url="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$work/tunnel.log" | head -1 || true)"
  test -z "$tunnel_url" || break
  sleep .2
done
test -n "${tunnel_url:-}" || { cat "$work/tunnel.log" >&2; exit 1; }

old_endpoint="$(stripe webhook_endpoints create --api-version "$old_version" -d "url=$tunnel_url/$old_label" -d "enabled_events[0]=$event" | jq -er .id)"
new_endpoint="$(stripe webhook_endpoints create --api-version "$new_version" -d "url=$tunnel_url/$new_label" -d "enabled_events[0]=$event" | jq -er .id)"
"$@"

event_stem="${event//[^A-Za-z0-9._-]/_}"
for _ in $(seq 1 100); do
  old_raw="$(find "fixtures/raw/$old_label" -type f -name "$event_stem.*.json" ! -name '*.meta.json' -newer "$work" -print 2>/dev/null | sort | tail -1)"
  new_raw="$(find "fixtures/raw/$new_label" -type f -name "$event_stem.*.json" ! -name '*.meta.json' -newer "$work" -print 2>/dev/null | sort | tail -1)"
  test -z "$old_raw" || test -z "$new_raw" || break
  sleep .2
done
test -n "${old_raw:-}" && test -n "${new_raw:-}" || { cat "$work/server.log" >&2; exit 1; }

node tools/normalize-fixtures.js --pair "$pair" --role "$role" --namespace "$namespace" \
  --old "$old_raw" --new "$new_raw" --capture-method B
node tools/normalize-fixtures.js --verify --pair "$pair"
if git grep --no-index -nE '(sk|rk|pk)_(live|test)_|whsec_|ghp_|github_pat_' -- "fixtures/normalized/$pair" "$old_raw" "$new_raw"; then
  echo "Credential-like material found; capture rejected." >&2
  exit 1
fi
echo "Capture complete: $pair"
echo "Raw old: $old_raw"
echo "Raw new: $new_raw"
