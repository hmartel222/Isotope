"""Bounded JSON serialization matching the TypeScript harness sentinels."""
from __future__ import annotations

import hashlib
import math
from datetime import datetime
from typing import Any, Callable


def serialize_behavior(value: Any, on_limit: Callable[[str], None] | None = None) -> Any:
    ancestors: set[int] = set()
    budget = 10_000
    text_budget = 1_048_576

    def limit(name: str) -> str:
        if on_limit:
            on_limit(name)
        return f"__{name}_limit__"

    def visit(v: Any, depth: int) -> Any:
        nonlocal budget, text_budget
        budget -= 1
        if budget < 0:
            return limit("node")
        if depth > 20:
            return limit("depth")
        if v is None:
            return None
        if isinstance(v, bool):
            return v
        if isinstance(v, int) and not isinstance(v, bool):
            return v
        if isinstance(v, float):
            if math.isnan(v):
                return "__NaN__"
            if math.isinf(v):
                return "__Infinity__" if v > 0 else "__-Infinity__"
            return v
        if isinstance(v, str):
            allowed = max(0, min(65536, text_budget))
            text_budget -= min(len(v), allowed)
            return v if len(v) <= allowed else v[:allowed] + limit("string")
        if callable(v):
            return "__fn__"
        if isinstance(v, datetime):
            return v.isoformat()
        if isinstance(v, (bytes, bytearray)):
            return {"__buffer__": hashlib.sha256(bytes(v)).hexdigest()}
        if isinstance(v, dict):
            ident = id(v)
            if ident in ancestors:
                return "__circular__"
            ancestors.add(ident)
            keys = sorted(str(k) for k in v.keys())
            out: dict[str, Any] = {}
            for key in keys[:500]:
                if budget <= 0:
                    out["__node_limit__"] = limit("node")
                    break
                out[key] = visit(v[key] if key in v else v.get(key), depth + 1)
            if len(keys) > 500:
                out["__breadth_limit__"] = limit("breadth")
            ancestors.discard(ident)
            return out
        if isinstance(v, (list, tuple)):
            ident = id(v)
            if ident in ancestors:
                return "__circular__"
            ancestors.add(ident)
            values = []
            seq = list(v)
            for item in seq[:500]:
                if budget <= 0:
                    values.append(limit("node"))
                    break
                values.append(visit(item, depth + 1))
            if len(seq) > 500:
                values.append(limit("breadth"))
            ancestors.discard(ident)
            return values
        return str(v)

    return visit(value, 0)
