#!/usr/bin/env bash
# Copy the built trees in harness/stripe/customer-repos/ onto the four public
# demo remotes and pin the Action SHA to this engine HEAD.
# Run from a clone of hophacksf26 with git credentials that can push to
# hmartel222/isotope-demo-*. Set AUDIT_AFTER_PUSH=1 to wait for and validate
# the resulting Isotope checks and PR comments.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENGINE_SHA="${ENGINE_SHA:-$(git -C "$ROOT" rev-parse HEAD)}"
OWNER="${OWNER:-hmartel222}"
WORKDIR="${WORKDIR:-$(mktemp -d /tmp/isotope-demos-XXXX)}"
BUILT="$ROOT/harness/stripe/customer-repos"

if ! git -C "$ROOT" cat-file -e "${ENGINE_SHA}^{commit}" 2>/dev/null; then
  echo "engine SHA is not a local commit: $ENGINE_SHA" >&2
  exit 1
fi

pin_action_sha() {
  local dest="$1"
  python3 - "$dest" "$ENGINE_SHA" <<'PY'
import pathlib, re, sys
dest, sha = sys.argv[1:3]
out = pathlib.Path(dest) / ".github/workflows"
for name in ("isotope-verify.yml", "isotope-report.yml"):
    path = out / name
    text = path.read_text()
    text = re.sub(
        r"(hmartel222/hophacksf26/action@)[0-9a-f]{40}",
        r"\g<1>" + sha,
        text,
        count=1,
    )
    path.write_text(text)
PY
}

sync_repo() {
  local repo="$1"
  local src="$BUILT/$repo"
  local dir="$WORKDIR/$repo"
  if [[ ! -d "$src" ]]; then
    echo "missing built tree: $src" >&2
    exit 1
  fi
  echo "=== $repo (from customer-repos/$repo sha=$ENGINE_SHA) ==="
  git clone --depth=1 "https://github.com/${OWNER}/${repo}.git" "$dir"
  git -C "$dir" config user.name "Isotope Demo Deployer"
  git -C "$dir" config user.email "isotope-demo@users.noreply.github.com"
  # Overlay the committed customer tree; keep the remote .git.
  find "$dir" -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +
  cp -a "$src"/. "$dir/"
  pin_action_sha "$dir"
  git -C "$dir" add -A
  if git -C "$dir" diff --cached --quiet; then
    echo "no changes"
  else
    git -C "$dir" commit -m "Sync built customer tree and pin Isotope Action ${ENGINE_SHA}"
    git -C "$dir" push origin HEAD
  fi
  # Fast-forward the open Dependabot branch so the PR merge commit sees the new workflows.
  git -C "$dir" fetch origin '+refs/heads/dependabot/npm_and_yarn/stripe-22.6.2:refs/remotes/origin/dependabot/npm_and_yarn/stripe-22.6.2' || true
  if git -C "$dir" rev-parse --verify origin/dependabot/npm_and_yarn/stripe-22.6.2 >/dev/null 2>&1; then
    git -C "$dir" checkout -B dependabot/npm_and_yarn/stripe-22.6.2 origin/dependabot/npm_and_yarn/stripe-22.6.2
    if ! git -C "$dir" merge --no-edit origin/HEAD; then
      git -C "$dir" merge --abort || true
      echo "could not synchronize $repo Dependabot branch with main" >&2
      exit 1
    fi
    git -C "$dir" push origin dependabot/npm_and_yarn/stripe-22.6.2
  fi
}

sync_repo isotope-demo-mechanical
sync_repo isotope-demo-migrated
sync_repo isotope-demo-aggregating
sync_repo isotope-demo-ambiguity

echo "Pinned Action SHA: $ENGINE_SHA"
echo "Set GEMINI_API_KEY as both an Actions secret and a Dependabot secret on isotope-demo-aggregating for case 9."

if [[ "${AUDIT_AFTER_PUSH:-0}" == "1" ]]; then
  OWNER="$OWNER" ENGINE_SHA="$ENGINE_SHA" "$ROOT/harness/stripe/audit-customer-demos.sh"
else
  echo "Run harness/stripe/audit-customer-demos.sh after GitHub Actions completes."
fi
