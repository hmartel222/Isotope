"""Isolated Python handler execution with mocked I/O. No verdicts."""
from __future__ import annotations

import importlib.util
import importlib
import copy
import inspect
import json
import random
import socket
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


class ProviderCallable:
    def __init__(self, descriptor: dict[str, Any], fixture: Any, path: list[str], calls: list[dict[str, Any]], returns: dict[str, Any], invocations: dict[str, int]):
        self._descriptor = descriptor
        self._fixture = fixture
        self._path = path
        self._calls = calls
        self._returns = returns
        self._invocations = invocations

    def __getattr__(self, key: str) -> "ProviderCallable":
        if key.startswith("_") or key == "then":
            raise AttributeError(key)
        return ProviderCallable(self._descriptor, self._fixture, [*self._path, key], self._calls, self._returns, self._invocations)

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        name = ".".join(self._path)
        short_name = ".".join(self._path[1:])
        paths = {name, short_name}
        if paths.intersection(self._descriptor.get("intercept") or []):
            adapter_id = self._descriptor["id"]
            self._invocations[adapter_id] = self._invocations.get(adapter_id, 0) + 1
            return copy.deepcopy(self._fixture)
        records = self._descriptor.get("records") or {}
        record_name = next((path for path in paths if path in records), None)
        if record_name:
            return Recorder(f"{self._descriptor['module']}.{record_name}", records[record_name], self._calls, self._returns)(*args, **kwargs)
        return self


def _provider_descriptor(mock: dict[str, Any]) -> dict[str, Any]:
    if mock.get("adapter") not in {"fixture-call", "real-method"}:
        raise HarnessFailure("unsupported_harness_plan", f"Python provider mock {mock['module']} requires adapter: fixture-call or real-method")
    intercept = list(dict.fromkeys(mock.get("intercept") or []))
    exports = list(dict.fromkeys(mock.get("exports") or ["default"]))
    if not intercept or not exports:
        raise HarnessFailure("unsupported_harness_plan", "Provider exports and intercept paths must not be empty")
    return {"id": f"{mock['adapter']}:{mock['module']}", "module": mock["module"], "adapter": mock["adapter"],
            "intercept": intercept, "exports": exports, "records": mock.get("records") or {},
            "required": mock.get("required", True), "response": mock.get("response")}


def _canonical_response(response: dict[str, Any], original: Any, args: tuple[Any, ...], kwargs: dict[str, Any]) -> Any:
    try:
        values = dict(inspect.signature(original).bind_partial(*args, **kwargs).arguments)
    except (TypeError, ValueError):
        values = dict(kwargs)
    logical: dict[str, Any] = {}
    for output, aliases in response["fields"].items():
        logical[output] = next((values[name] for name in aliases if name in values), None)
    content = response.get("prefix", "").encode("utf-8") + json.dumps(
        logical, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    chunks = max(1, int(response.get("chunks", 1)))
    if chunks == 1:
        return content
    size = max(1, len(content) // chunks)
    return iter(content[index:index + size] for index in range(0, len(content), size))


def _install_real_method(descriptor: dict[str, Any], invocations: dict[str, int]) -> None:
    module = importlib.import_module(descriptor["module"])
    response = descriptor.get("response")
    if not response or response.get("kind") != "canonical-json-bytes":
        raise HarnessFailure("unsupported_harness_plan", "real-method requires a canonical-json-bytes response")
    invocations[descriptor["id"]] = 0
    paths = descriptor["intercept"]
    by_class: dict[str, list[list[str]]] = {}
    for path in paths:
        parts = path.split(".")
        if len(parts) < 2:
            raise HarnessFailure("unsupported_harness_plan", f"real-method path must start with a class export: {path}")
        by_class.setdefault(parts[0], []).append(parts[1:])
    for class_name, targets in by_class.items():
        cls = getattr(module, class_name, None)
        if not isinstance(cls, type):
            raise HarnessFailure("mock_resolution_failed", f"Class export not found: {descriptor['module']}.{class_name}")
        original_init = cls.__init__

        def patched_init(self: Any, *args: Any, __init: Any = original_init, __targets: list[list[str]] = targets, **kwargs: Any) -> None:
            __init(self, *args, **kwargs)
            for target in __targets:
                owner = self
                for member in target[:-1]:
                    owner = getattr(owner, member)
                method_name = target[-1]
                original = getattr(owner, method_name)

                def intercepted(*call_args: Any, __original: Any = original, **call_kwargs: Any) -> Any:
                    invocations[descriptor["id"]] += 1
                    return _canonical_response(response, __original, call_args, call_kwargs)

                setattr(owner, method_name, intercepted)

        cls.__init__ = patched_init


def _install_method_recorder(mock: dict[str, Any], calls: list[dict[str, Any]], returns: dict[str, Any]) -> None:
    module = importlib.import_module(mock["module"])
    for path in (mock.get("exports") or {}):
        parts = path.split(".")
        owner: Any = module
        for member in parts[:-1]:
            owner = getattr(owner, member, None)
            if owner is None:
                raise HarnessFailure("mock_resolution_failed", f"Recorder owner not found: {mock['module']}.{path}")
        method_name = parts[-1]
        original = getattr(owner, method_name, None)
        if not callable(original):
            raise HarnessFailure("mock_resolution_failed", f"Recorder method not found: {mock['module']}.{path}")
        record_name = f"{mock['module'].split('.')[-1]}.{method_name}"
        bound_to_class = isinstance(owner, type)

        def recorded(*args: Any, __original: Any = original, __name: str = record_name, __bound: bool = bound_to_class, **kwargs: Any) -> Any:
            payload = kwargs if kwargs else list(args[1:] if args and __bound else args)
            calls.append({"seq": len(calls), "mock": __name, "sinkKind": mock["sinkKind"],
                          "args": serialize_behavior([payload] if isinstance(payload, dict) else payload)})
            return __original(*args, **kwargs)

        setattr(owner, method_name, recorded)


def _install_mocks(plan: dict[str, Any], calls: list[dict[str, Any]], fixture: Any, invocations: dict[str, int]) -> None:
    returns = plan.get("mockReturns") or {}
    for mock in plan.get("mocks") or []:
        if "strategy" in mock:
            descriptor = _provider_descriptor(mock)
            if descriptor["adapter"] == "real-method":
                _install_real_method(descriptor, invocations)
                continue
            rec = types.ModuleType(mock["module"])
            invocations[descriptor["id"]] = 0
            for export in descriptor["exports"]:
                setattr(rec, export, ProviderCallable(descriptor, fixture, [export], calls, returns, invocations))
            sys.modules[mock["module"]] = rec
            if "." in mock["module"]:
                sys.modules[mock["module"].split(".")[-1]] = rec
            continue
        if mock.get("adapter") == "method-record":
            _install_method_recorder(mock, calls, returns)
            continue
        module_name = mock["module"]
        rec = types.ModuleType(module_name)
        for export, _mode in (mock.get("exports") or {}).items():
            setattr(rec, export, Recorder(export, mock["sinkKind"], calls, returns))
        sys.modules[module_name] = rec
        if "." in module_name:
            sys.modules[module_name.split(".")[-1]] = rec


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
    _install_mocks(plan, calls, fixture, invocations)
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
