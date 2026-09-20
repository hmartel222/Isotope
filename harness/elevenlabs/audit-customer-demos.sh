#!/usr/bin/env bash
# Validate the public ElevenLabs demo PRs, Action conclusions, and bot-owned
# rationale comments.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OWNER="${OWNER:-hmartel222}"
DEFAULT_ENGINE_SHA="$(sed -nE 's/.*hophacksf26\/action@([0-9a-f]{40}).*/\1/p' "$ROOT/harness/elevenlabs/customer-repos/isotope-demo-elevenlabs-removal/.github/workflows/isotope-verify.yml" | head -1)"
ENGINE_SHA="${ENGINE_SHA:-$DEFAULT_ENGINE_SHA}"
WAIT_SECONDS="${WAIT_SECONDS:-600}"
POLL_SECONDS="${POLL_SECONDS:-15}"

command -v gh >/dev/null || { echo "gh is required" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }

expected_heading() {
  case "$1" in
    isotope-demo-elevenlabs-removal) printf '%s' 'Isotope — incompatibility detected' ;;
    isotope-demo-elevenlabs-fallback) printf '%s' 'Isotope needs a decision' ;;
    *) return 1 ;;
  esac
}

audit_repo() {
  local repo="$1" deadline workflow pin pr_json pr_number run_json status conclusion run_url comments body comment_url heading
  deadline=$((SECONDS + WAIT_SECONDS))
  workflow="$(gh api -H 'Accept: application/vnd.github.raw+json' "repos/${OWNER}/${repo}/contents/.github/workflows/isotope-verify.yml?ref=main")"
  pin="$(printf '%s\n' "$workflow" | sed -nE 's/.*hophacksf26\/action@([0-9a-f]{40}).*/\1/p' | head -1)"
  [[ "$pin" == "$ENGINE_SHA" ]] || { echo "$repo: expected Action $ENGINE_SHA, found ${pin:-none}" >&2; return 1; }

  while :; do
    pr_json="$(gh pr list --repo "${OWNER}/${repo}" --state open --search 'author:app/dependabot' --limit 1 --json number,url,headRefName)"
    pr_number="$(jq -r '.[0].number // empty' <<<"$pr_json")"
    [[ -n "$pr_number" ]] && break
    (( SECONDS < deadline )) || { echo "$repo: Dependabot PR did not appear within ${WAIT_SECONDS}s" >&2; return 1; }
    sleep "$POLL_SECONDS"
  done

  while :; do
    run_json="$(gh run list --repo "${OWNER}/${repo}" --workflow 'Isotope verify' --event pull_request --branch "$(jq -r '.[0].headRefName' <<<"$pr_json")" --limit 1 --json databaseId,status,conclusion,url)"
    status="$(jq -r '.[0].status // "missing"' <<<"$run_json")"
    [[ "$status" == completed ]] && break
    (( SECONDS < deadline )) || { echo "$repo: Isotope verify did not complete (status=$status)" >&2; return 1; }
    sleep "$POLL_SECONDS"
  done
  conclusion="$(jq -r '.[0].conclusion' <<<"$run_json")"
  run_url="$(jq -r '.[0].url' <<<"$run_json")"
  [[ "$conclusion" == failure ]] || { echo "$repo: expected blocking failure, got $conclusion" >&2; return 1; }

  heading="$(expected_heading "$repo")"
  while :; do
    comments="$(gh api "repos/${OWNER}/${repo}/issues/${pr_number}/comments")"
    body="$(jq -r '[.[] | select(.body | contains("<!-- isotope-report -->"))] | last | .body // ""' <<<"$comments")"
    comment_url="$(jq -r '[.[] | select(.body | contains("<!-- isotope-report -->"))] | last | .html_url // ""' <<<"$comments")"
    [[ "$body" == *"$heading"* && "$body" == *'elevenlabs'* && "$body" == *'1.59.0'* ]] && break
    (( SECONDS < deadline )) || { echo "$repo: expected Isotope rationale comment was not published" >&2; return 1; }
    sleep "$POLL_SECONDS"
  done
  printf '%s\t%s\t%s\t%s\t%s\n' "$repo" "$conclusion" "$(jq -r '.[0].url' <<<"$pr_json")" "$run_url" "$comment_url"
}

printf 'REPOSITORY\tCHECK\tPR\tRUN\tCOMMENT\n'
audit_repo isotope-demo-elevenlabs-removal
audit_repo isotope-demo-elevenlabs-fallback

