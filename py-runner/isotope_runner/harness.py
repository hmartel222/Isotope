"""Isolated Python handler execution with mocked I/O. No verdicts."""
from __future__ import annotations

import importlib.util
import random
import sys
import time
import types
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .serialize import serialize_behavior


class HarnessFailure(Exception):
    def __init__(self, reason: str, message: str):
        super().__init__(message)
        self.reason = reason
        self.message = message


class Recorder:
    def __init__(self, name: str, sink_kind: str, calls: list[dict[str, Any]], returns: dict[str, Any]):
        self._name = name
        self._sink = sink_kind
        self._calls = calls
        self._returns = returns

    def __getattr__(self, key: str) -> "Recorder":
        if key.startswith("_") or key in {"__call__", "then"}:
            raise AttributeError(key)
        return Recorder(f"{self._name}.{key}", self._sink, self._calls, self._returns)

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        if len(self._calls) >= 5000:
            raise HarnessFailure("serialization_limit", "Call count exceeded 5000")
        payload = kwargs if kwargs else list(args)
        self._calls.append({
            "seq": len(self._calls), "mock": self._name, "sinkKind": self._sink,
            "args": serialize_behavior([payload] if isinstance(payload, dict) else payload),
        })
        return self._returns.get(self._name)


def _install_mocks(plan: dict[str, Any], calls: list[dict[str, Any]]) -> None:
    returns = plan.get("mockReturns") or {}
    for mock in plan.get("mocks") or []:
        if "strategy" in mock:
            continue
        module_name = mock["module"]
        rec = types.ModuleType(module_name)
        for export, _mode in (mock.get("exports") or {}).items():
            setattr(rec, export, Recorder(export, mock["sinkKind"], calls, returns))
        sys.modules[module_name] = rec
        if "." in module_name:
            sys.modules[module_name.split(".")[-1]] = rec


def _load(path: str, export: str) -> Any:
    spec = importlib.util.spec_from_file_location("isotope_customer_entry", path)
    if spec is None or spec.loader is None:
        raise HarnessFailure("harness_could_not_run", f"Cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["isotope_customer_entry"] = module
    spec.loader.exec_module(module)
    if not hasattr(module, export):
        raise HarnessFailure("harness_could_not_run", f"Missing export {export}")
    return getattr(module, export)


def _invoke(kind: str, handler: Any, fixture: Any) -> Any:
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

        req = {"body": fixture, "rawBody": fixture, "headers": {"stripe-signature": "isotope-mocked-signature"}}
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
    _install_mocks(plan, calls)
    started = time.perf_counter()
    handler = _load(plan["entryFile"], plan["entryPoint"]["exportName"])
    fixture = plan["fixturePayload"]
    threw = None
    returned: Any = None
    try:
        returned = _invoke(plan["entryPoint"]["kind"], handler, fixture)
    except HarnessFailure:
        raise
    except Exception as error:  # customer throw is behavior
        threw = {"name": type(error).__name__, "message": str(error)[:8192]}
        returned = None
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
