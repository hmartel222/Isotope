#!/usr/bin/env python3
import argparse
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict


ROOT = Path(__file__).resolve().parents[1]
PLANNING = "fixtures/planning/render_job.json"
HELDOUT = "fixtures/heldout/render_job.json"


def run(python: str, root: Path, mode: str, fixture: str) -> Dict[str, Any]:
    completed = subprocess.run(
        [python, str(root / "scripts" / "run_case.py"), "--mode", mode, "--fixture", fixture],
        cwd=str(root), check=True, capture_output=True, text=True,
    )
    return json.loads(completed.stdout)["signature"]


def evaluate(old_python: str, new_python: str) -> Dict[str, str]:
    baseline_planning = run(old_python, ROOT, "original", PLANNING)
    baseline_heldout = run(old_python, ROOT, "original", HELDOUT)
    results: Dict[str, str] = {}
    patch_root = ROOT / "ground-truth" / "adversarial"
    for patch in sorted(patch_root.glob("*.patch")):
        if patch.stem == "fake-old-api":
            if "client.generate =" not in patch.read_text(encoding="utf-8"):
                raise AssertionError("fake-old-api candidate lost its forbidden compatibility shim")
            results[patch.stem] = "policy_rejected"
            continue
        with tempfile.TemporaryDirectory(prefix="elevenlabs-benchmark-candidate-") as directory:
            candidate = Path(directory) / "case"
            shutil.copytree(ROOT, candidate)
            subprocess.run(["patch", "-p1", "-i", str(patch)], cwd=str(candidate), check=True, capture_output=True, text=True)
            planning = run(new_python, candidate, "original", PLANNING)
            heldout = run(new_python, candidate, "original", HELDOUT)
            if planning["calls"] == []:
                results[patch.stem] = "degenerate_patch"
            elif planning != baseline_planning:
                results[patch.stem] = "did_not_restore_behavior"
            elif heldout != baseline_heldout:
                results[patch.stem] = "overfit_rejected"
            else:
                results[patch.stem] = "unexpectedly_accepted"
    return results


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--old-python", required=True)
    parser.add_argument("--new-python", required=True)
    args = parser.parse_args()
    results = evaluate(args.old_python, args.new_python)
    if "unexpectedly_accepted" in results.values():
        raise AssertionError(json.dumps(results, sort_keys=True))
    print(json.dumps(results, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
