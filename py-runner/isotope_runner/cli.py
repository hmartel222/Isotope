#!/usr/bin/env python3
"""JSON stdin/stdout sidecar for Python L2/L3. No network."""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from isotope_runner.harness import HarnessFailure, run_harness  # noqa: E402
from isotope_runner.resolver import resolve  # noqa: E402


def main() -> int:
    payload = json.load(sys.stdin)
    command = payload.get("command")
    try:
        if command == "resolve":
            json.dump({"bdg": resolve(payload)}, sys.stdout)
            return 0
        if command == "harness":
            json.dump({"signature": run_harness(payload["plan"])}, sys.stdout)
            return 0
        json.dump({"error": {"reason": "unsupported_harness_plan", "message": f"Unknown command {command}"}}, sys.stdout)
        return 0
    except HarnessFailure as error:
        json.dump({"error": {"reason": error.reason, "message": error.message}}, sys.stdout)
        return 0
    except Exception as error:  # noqa: BLE001
        json.dump({"error": {"reason": "harness_could_not_run", "message": str(error)[:8192]}}, sys.stdout)
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
