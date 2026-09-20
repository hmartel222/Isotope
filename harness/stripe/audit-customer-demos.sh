#!/usr/bin/env bash
# Validate that every public Stripe demo ran the pinned Isotope Action and
# published one bot-owned rationale comment on its Dependabot pull request.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OWNER="${OWNER:-hmartel222}"
DEFAULT_ENGINE_SHA="$(sed -nE 's/.*hophacksf26\/action@([0-9a-f]{40}).*/\1/p' "$ROOT/harness/stripe/customer-repos/isotope-demo-mechanical/.github/workflows/isotope-verify.yml" | head -1)"
ENGINE_SHA="${ENGINE_SHA:-$DEFAULT_ENGINE_SHA}"
WAIT_SECONDS="${WAIT_SECONDS:-300}"
POLL_SECONDS="${POLL_SECONDS:-10}"

command -v gh >/dev/null || { echo "gh is required" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }

expected_comment() {
  case "$1" in
    isotope-demo-mechanical) printf '%s' 'Isotope — incompatibility detected' ;;
    isotope-demo-migrated) printf '%s' 'Isotope — compatible' ;;
    isotope-demo-aggregating) printf '%s' 'stripe.basil.subscription-period' ;;
    isotope-demo-ambiguity) printf '%s' 'Isotope needs a decision' ;;
    *) return 1 ;;
  esac
}

expected_conclusion() {
  case "$1" in
    isotope-demo-migrated) printf '%s' 'success' ;;
    isotope-demo-aggregating) printf '%s' 'success|failure' ;;
    *) printf '%s' 'failure' ;;
  esac
}

audit_repo() {
  local repo="$1" deadline workflow pin run_json status conclusion run_url comment_json comment_body comment_url expected_body expected_result
  deadline=$((SECONDS + WAIT_SECONDS))
  workflow="$(gh api -H 'Accept: application/vnd.github.raw+json' "repos/${OWNER}/${repo}/contents/.github/workflows/isotope-verify.yml?ref=main")"
  pin="$(printf '%s\n' "$workflow" | sed -nE 's/.*hophacksf26\/action@([0-9a-f]{40}).*/\1/p' | head -1)"
  if [[ "$pin" != "$ENGINE_SHA" ]]; then
    echo "$repo: expected Action $ENGINE_SHA, found ${pin:-none}" >&2
    return 1
  fi

  while :; do
    run_json="$(gh run list --repo "${OWNER}/${repo}" --workflow 'Isotope verify' --event pull_request --limit 1 --json databaseId,status,conclusion,url,headSha)"
    status="$(jq -r '.[0].status // "missing"' <<<"$run_json")"
    if [[ "$status" == "completed" ]]; then break; fi
    if (( SECONDS >= deadline )); then
      echo "$repo: verification did not complete within ${WAIT_SECONDS}s (status=$status)" >&2
      return 1
    fi
    sleep "$POLL_SECONDS"
  done

  conclusion="$(jq -r '.[0].conclusion' <<<"$run_json")"
  run_url="$(jq -r '.[0].url' <<<"$run_json")"
  expected_result="$(expected_conclusion "$repo")"
  if [[ ! "$conclusion" =~ ^(${expected_result})$ ]]; then
    echo "$repo: unexpected verification conclusion $conclusion" >&2
    return 1
  fi

  expected_body="$(expected_comment "$repo")"
  while :; do
    comment_json="$(gh api "repos/${OWNER}/${repo}/issues/1/comments")"
    comment_body="$(jq -r '[.[] | select(.body | contains("<!-- isotope-report -->"))] | last | .body // ""' <<<"$comment_json")"
    comment_url="$(jq -r '[.[] | select(.body | contains("<!-- isotope-report -->"))] | last | .html_url // ""' <<<"$comment_json")"
    if [[ "$comment_body" == *"$expected_body"* && "$comment_body" == *'stripe` `17.7.0` → `22.6.2'* ]]; then break; fi
    if (( SECONDS >= deadline )); then
      echo "$repo: expected Isotope rationale comment was not published" >&2
      return 1
    fi
    sleep "$POLL_SECONDS"
  done

  if [[ "$repo" == "isotope-demo-mechanical" && "$comment_body" != *'Verified repair available'* ]]; then
    echo "$repo: mechanical rationale is missing the verified repair" >&2
    return 1
  fi
  if [[ "$repo" == "isotope-demo-aggregating" && "$comment_body" != *'reasoned benign adaptation'* && "$comment_body" != *'needs a decision'* ]]; then
    echo "$repo: aggregation rationale is neither PASS_REASONED nor ESCALATE" >&2
    return 1
  fi

  printf '%s\t%s\t%s\t%s\n' "$repo" "$conclusion" "$run_url" "$comment_url"
}

printf 'REPOSITORY\tCHECK\tRUN\tCOMMENT\n'
audit_repo isotope-demo-mechanical
audit_repo isotope-demo-migrated
audit_repo isotope-demo-aggregating
audit_repo isotope-demo-ambiguity
