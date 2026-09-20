#!/usr/bin/env bash
# Overlay harness targets onto the four public demo repos and pin the Action SHA.
# Run from a clone of hophacksf26 on this branch, with git credentials that can
# push to hmartel222/isotope-demo-*. This cloud agent token can only write the
# engine repository.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENGINE_SHA="${ENGINE_SHA:-$(git -C "$ROOT" rev-parse HEAD)}"
OWNER="${OWNER:-hmartel222}"
WORKDIR="${WORKDIR:-$(mktemp -d /tmp/isotope-demos-XXXX)}"

overlay_workflow() {
  local dest="$1" reasoner="$2" repair="$3"
  python3 - "$ROOT" "$dest" "$ENGINE_SHA" "$reasoner" "$repair" <<'PY'
import pathlib, sys
root, dest, sha, reasoner, repair = sys.argv[1:6]
src = pathlib.Path(root) / "harness/stripe/customer-template/.github/workflows"
out = pathlib.Path(dest) / ".github/workflows"
out.mkdir(parents=True, exist_ok=True)
for name in ("isotope-verify.yml", "isotope-report.yml"):
    text = (src / name).read_text()
    text = text.replace("101e9c7432976e8ea29fa7119b6176be06a04d28", sha)
    if name == "isotope-verify.yml":
        text = text.replace("reasoner: off", f"reasoner: {reasoner}", 1)
        text = text.replace("repair: off", f"repair: {repair}", 1)
    (out / name).write_text(text)
PY
}

sync_repo() {
  local repo="$1" target="$2" reasoner="$3" repair="$4"
  local dir="$WORKDIR/$repo"
  echo "=== $repo (target=$target reasoner=$reasoner repair=$repair sha=$ENGINE_SHA) ==="
  git clone --depth=1 "https://github.com/${OWNER}/${repo}.git" "$dir"
  rm -rf "$dir/src"
  cp -a "$ROOT/harness/stripe/targets/$target/src" "$dir/src"
  cp "$ROOT/harness/stripe/targets/$target/isotope.yml" "$dir/isotope.yml"
  cp "$ROOT/harness/stripe/targets/$target/README.md" "$dir/README.md"
  overlay_workflow "$dir" "$reasoner" "$repair"
  git -C "$dir" add -A
  if git -C "$dir" diff --cached --quiet; then
    echo "no changes"
  else
    git -C "$dir" commit -m "Pin Isotope Action ${ENGINE_SHA} and sync ${target} harness target"
    git -C "$dir" push origin HEAD
  fi
  # Fast-forward the open Dependabot branch so the PR merge commit sees the new workflows.
  git -C "$dir" fetch origin '+refs/heads/dependabot/npm_and_yarn/stripe-22.6.2:refs/remotes/origin/dependabot/npm_and_yarn/stripe-22.6.2' || true
  if git -C "$dir" rev-parse --verify origin/dependabot/npm_and_yarn/stripe-22.6.2 >/dev/null 2>&1; then
    git -C "$dir" checkout -B dependabot/npm_and_yarn/stripe-22.6.2 origin/dependabot/npm_and_yarn/stripe-22.6.2
    git -C "$dir" merge --no-edit origin/HEAD || git -C "$dir" merge --no-edit main
    git -C "$dir" push origin dependabot/npm_and_yarn/stripe-22.6.2
  fi
}

sync_repo isotope-demo-mechanical 12-repair off on
sync_repo isotope-demo-migrated 03-migrated off off
sync_repo isotope-demo-aggregating 09-aggregating on off
sync_repo isotope-demo-ambiguity 07-ambiguity off off

echo "Pinned Action SHA: $ENGINE_SHA"
echo "Set GEMINI_API_KEY as both an Actions secret and a Dependabot secret on isotope-demo-aggregating for case 9."
