"""Isolated Python handler execution with mocked I/O. No verdicts."""
from __future__ import annotations

import importlib
import importlib.util
import random
import socket
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .adapters import install_mocks
from .errors import HarnessFailure
from .serialize import serialize_behavior


def _load(path: str, export: str, repository_root: str) -> Any:
    relative = Path(path).resolve().relative_to(Path(repository_root).resolve())
    if relative.suffix == ".py" and all(part.isidentifier() for part in relative.with_suffix("").parts):
        return getattr(importlib.import_module(".".join(relative.with_suffix("").parts)), export)
    spec = importlib.util.spec_from_file_location("isotope_customer_entry", path)
    if spec is None or spec.loader is None:
        raise HarnessFailure("harness_could_not_run", f"Cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["isotope_customer_entry"] = module
    spec.loader.exec_module(module)
    if not hasattr(module, export):
        raise HarnessFailure("harness_could_not_run", f"Missing export {export}")
    return getattr(module, export)


def _invoke(kind: str, handler: Any, fixture: Any, request_headers: dict[str, str]) -> Any:
    if kind == "plain":
        return handler(fixture)
    if kind == "lambda":
        return handler(fixture, {"awsRequestId": "isotope"})
    if kind in {"express_route", "next_pages_api"}:
        status = {"code": 200, "body": None, "sent": False}

        class Res:
            def status(self, code: int) -> "Res":
                status["code"] = code
                return self

            def json(self, value: Any) -> "Res":
                status["body"] = value
                status["sent"] = True
                return self

            def send(self, value: Any) -> "Res":
                return self.json(value)

        req = {"body": fixture, "rawBody": fixture, "headers": dict(request_headers)}
        output = handler(req, Res())
        return {"status": status["code"], "body": status["body"]} if status["sent"] else output
    if kind == "next_app_route":
        req = {"method": "POST", "json": lambda: fixture, "body": fixture}
        return handler(req)
    raise HarnessFailure("adapter_not_implemented", f"Adapter {kind} is not implemented")


def run_harness(plan: dict[str, Any]) -> dict[str, Any]:
    random.seed(0)
    random.random = lambda: 0.5  # type: ignore[method-assign]
    time.time = lambda: 1_767_225_600  # type: ignore[assignment]
    uuid.uuid4 = lambda: uuid.UUID("00000000-0000-4000-8000-000000000001")  # type: ignore[method-assign]
    calls: list[dict[str, Any]] = []
    invocations: dict[str, int] = {}
    fixture = plan["fixturePayload"]
    repository_root = str(Path(plan["repositoryRoot"]).resolve())
    if repository_root not in sys.path:
        sys.path.insert(0, repository_root)

    def blocked(*_args: Any, **_kwargs: Any) -> None:
        raise HarnessFailure("blocked_egress", "Python harness blocked an external network attempt")

    socket.socket.connect = blocked  # type: ignore[method-assign]
    socket.create_connection = blocked  # type: ignore[assignment]
    socket.getaddrinfo = blocked  # type: ignore[assignment]
    install_mocks(plan, calls, fixture, invocations)
    started = time.perf_counter()
    handler = _load(plan["entryFile"], plan["entryPoint"]["exportName"], repository_root)
    threw = None
    returned: Any = None
    try:
        returned = _invoke(plan["entryPoint"]["kind"], handler, fixture, plan.get("requestHeaders") or {})
    except HarnessFailure:
        raise
    except Exception as error:  # customer throw is behavior
        threw = {"name": type(error).__name__, "message": str(error)[:8192]}
        returned = None
    required = {f"{mock.get('adapter')}:{mock['module']}" for mock in plan.get("mocks") or [] if "strategy" in mock and mock.get("required", True)}
    if any(count == 0 for adapter, count in invocations.items() if adapter in required):
        missed = next(adapter for adapter, count in invocations.items() if adapter in required and count == 0)
        raise HarnessFailure("provider_stub_not_exercised", f"Provider interception was not exercised successfully: {missed}")
    duration = max(0.0, (time.perf_counter() - started) * 1000)
    return {
        "entryPointId": plan["entryPoint"]["id"],
        "codeVersion": plan["codeVersion"],
        "payloadVersion": plan["fixture"]["payloadVersion"],
        "fixturePair": plan["fixture"]["pairId"],
        "runIndex": plan["runIndex"],
        "returned": serialize_behavior(returned) if threw is None else "__undefined__",
        "threw": threw,
        "calls": calls,
        "durationMs": duration,
    }
