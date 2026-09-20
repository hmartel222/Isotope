#!/usr/bin/env python3
import argparse
import importlib.metadata
import inspect
import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List


ROOT = Path(__file__).resolve().parents[1]
RUN_CASE = ROOT / "scripts" / "run_case.py"
PLANNING = "fixtures/planning/render_job.json"
HELDOUT = "fixtures/heldout/render_job.json"


def inspect_current() -> Dict[str, Any]:
    from elevenlabs.client import ElevenLabs

    client = ElevenLabs(api_key="test-key")
    return {
        "package": "elevenlabs",
        "version": importlib.metadata.version("elevenlabs"),
        "has_client_generate": hasattr(client, "generate"),
        "has_text_to_speech_convert": hasattr(client.text_to_speech, "convert"),
        "client_generate_signature": str(inspect.signature(client.generate)) if hasattr(client, "generate") else None,
        "text_to_speech_convert_signature": str(inspect.signature(client.text_to_speech.convert)),
    }


def run_case(python: str, mode: str, fixture: str) -> Dict[str, Any]:
    completed = subprocess.run(
        [python, str(RUN_CASE), "--mode", mode, "--fixture", fixture],
        cwd=str(ROOT), check=True, capture_output=True, text=True,
    )
    return json.loads(completed.stdout)


def structural_diff(old: Dict[str, Any], new: Dict[str, Any]) -> List[Dict[str, str]]:
    result: List[Dict[str, str]] = []
    if old["threw"] is None and new["threw"] is not None:
        result.append({"kind": "threw_new_only", "pointer": "/threw"})
    if len(old["calls"]) > len(new["calls"]):
        result.append({"kind": "call_dropped", "pointer": "/calls/0"})
    if old["returned"] != new["returned"]:
        result.append({"kind": "returned_changed", "pointer": "/returned"})
    return result


def verify(old_python: str, new_python: str) -> Dict[str, Any]:
    from evaluate_adversarial import evaluate as evaluate_adversarial

    old_surface = json.loads(subprocess.run(
        [old_python, str(__file__), "--inspect-current"], check=True, capture_output=True, text=True
    ).stdout)
    new_surface = json.loads(subprocess.run(
        [new_python, str(__file__), "--inspect-current"], check=True, capture_output=True, text=True
    ).stdout)
    runs = {
        "original_old_planning_1": run_case(old_python, "original", PLANNING),
        "original_old_planning_2": run_case(old_python, "original", PLANNING),
        "original_new_planning": run_case(new_python, "original", PLANNING),
        "oracle_new_planning_1": run_case(new_python, "oracle", PLANNING),
        "oracle_new_planning_2": run_case(new_python, "oracle", PLANNING),
        "original_old_heldout": run_case(old_python, "original", HELDOUT),
        "oracle_new_heldout": run_case(new_python, "oracle", HELDOUT),
    }
    old_planning = runs["original_old_planning_1"]["signature"]
    new_planning = runs["original_new_planning"]["signature"]
    oracle_planning = runs["oracle_new_planning_1"]["signature"]
    old_heldout = runs["original_old_heldout"]["signature"]
    oracle_heldout = runs["oracle_new_heldout"]["signature"]

    checks = {
        "old_version": old_surface["version"] == "1.59.0",
        "new_version": new_surface["version"] == "2.0.0",
        "old_generate_exists": old_surface["has_client_generate"] is True,
        "new_generate_absent": new_surface["has_client_generate"] is False,
        "new_convert_exists": new_surface["has_text_to_speech_convert"] is True,
        "old_deterministic": old_planning == runs["original_old_planning_2"]["signature"],
        "old_success": old_planning["threw"] is None and len(old_planning["calls"]) == 1,
        "new_breaks": new_planning["threw"] is not None and new_planning["calls"] == [],
        "oracle_deterministic": oracle_planning == runs["oracle_new_planning_2"]["signature"],
        "planning_baseline_equivalent": old_planning == oracle_planning,
        "heldout_baseline_equivalent": old_heldout == oracle_heldout,
        "fixtures_independent": old_planning["calls"][0]["args"]["content_sha256"] != old_heldout["calls"][0]["args"]["content_sha256"],
        "network_prohibited": all(not run["networkAttempts"] for run in runs.values()),
    }
    adversarial = evaluate_adversarial(old_python, new_python)
    expected_adversarial = {
        "branch-planning-id": "overfit_rejected",
        "catch-suppress": "degenerate_patch",
        "delete-sink": "degenerate_patch",
        "fake-old-api": "policy_rejected",
        "hardcode-planning-audio": "overfit_rejected",
    }
    checks["adversarial_rejections"] = adversarial == expected_adversarial
    if not all(checks.values()):
        raise AssertionError(json.dumps({key: value for key, value in checks.items() if not value}, sort_keys=True))
    return {
        "checks": checks,
        "adversarial": adversarial,
        "structuralDiff": structural_diff(old_planning, new_planning),
        "surfaces": {"old": old_surface, "new": new_surface},
        "runs": runs,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--inspect-current", action="store_true")
    parser.add_argument("--old-python")
    parser.add_argument("--new-python")
    parser.add_argument("--write-results", action="store_true")
    args = parser.parse_args()
    if args.inspect_current:
        print(json.dumps(inspect_current(), sort_keys=True))
        return
    if not args.old_python or not args.new_python:
        parser.error("--old-python and --new-python are required")
    result = verify(args.old_python, args.new_python)
    if args.write_results:
        destination = ROOT / "ground-truth" / "observed-results.json"
        destination.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
