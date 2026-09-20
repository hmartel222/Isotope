#!/usr/bin/env bash
# Publish the two ElevenLabs customer repositories and pin their workflows to
# the exact Isotope engine commit being deployed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENGINE_SHA="${ENGINE_SHA:-$(git -C "$ROOT" rev-parse HEAD)}"
OWNER="${OWNER:-hmartel222}"
WORKDIR="${WORKDIR:-$(mktemp -d /tmp/isotope-elevenlabs-demos-XXXX)}"
BUILT="$ROOT/harness/elevenlabs/customer-repos"

command -v gh >/dev/null || { echo "gh is required" >&2; exit 1; }
if ! git -C "$ROOT" cat-file -e "${ENGINE_SHA}^{commit}" 2>/dev/null; then
  echo "engine SHA is not a local commit: $ENGINE_SHA" >&2
  exit 1
fi

pin_action_sha() {
  local dest="$1"
  python3 - "$dest" "$ENGINE_SHA" <<'PY'
import pathlib, re, sys
dest, sha = sys.argv[1:3]
for path in (pathlib.Path(dest) / ".github/workflows").glob("isotope-*.yml"):
    text = path.read_text()
    text, count = re.subn(
        r"(hmartel222/hophacksf26/action@)[0-9a-f]{40}",
        r"\g<1>" + sha,
        text,
    )
    if count != 1:
        raise SystemExit(f"expected one Action pin in {path}, found {count}")
    path.write_text(text)
PY
}

publish_repo() {
  local repo="$1" description="$2" src dir
  src="$BUILT/$repo"
  dir="$WORKDIR/$repo"
  if [[ ! -d "$src" ]]; then
    echo "missing built tree: $src" >&2
    exit 1
  fi
  if gh repo view "${OWNER}/${repo}" >/dev/null 2>&1; then
    git clone "https://github.com/${OWNER}/${repo}.git" "$dir"
    find "$dir" -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +
    cp -a "$src"/. "$dir"/
    pin_action_sha "$dir"
    git -C "$dir" config user.name "Isotope Demo Deployer"
    git -C "$dir" config user.email "isotope-demo@users.noreply.github.com"
    git -C "$dir" add -A
    if ! git -C "$dir" diff --cached --quiet; then
      git -C "$dir" commit -m "Sync ElevenLabs customer app and Isotope verification"
      git -C "$dir" push origin HEAD:main
    fi
  else
    cp -a "$src" "$dir"
    pin_action_sha "$dir"
    git -C "$dir" init --initial-branch=main
    git -C "$dir" config user.name "Isotope Demo Deployer"
    git -C "$dir" config user.email "isotope-demo@users.noreply.github.com"
    git -C "$dir" add -A
    git -C "$dir" commit -m "Add ElevenLabs customer app with Isotope verification"
    gh repo create "${OWNER}/${repo}" --public --description "$description" --source "$dir" --remote origin --push
  fi
  printf '%s\t%s\n' "$repo" "https://github.com/${OWNER}/${repo}"
}

publish_repo isotope-demo-elevenlabs-removal "Isotope demo: ElevenLabs Python v1 to v2 removed API interception"
publish_repo isotope-demo-elevenlabs-fallback "Isotope demo: ElevenLabs Python v1 to v2 fallback-policy escalation"
printf 'Pinned Isotope Action SHA: %s\n' "$ENGINE_SHA"
printf 'Dependabot will scan requirements.txt and open the dependency pull requests.\n'
