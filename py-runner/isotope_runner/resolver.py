"""Bounded stdlib-AST Python BDG resolver. No fixtures, verdicts, or network."""
from __future__ import annotations

import ast
import hashlib
import json
import re
from pathlib import Path
from typing import Any


def _stable(kind: str, *parts: Any) -> str:
    return f"{kind}_{hashlib.sha256(json.dumps(parts, sort_keys=True, default=str).encode()).hexdigest()[:20]}"


def _slash(path: str) -> str:
    return path.replace("\\", "/")


def _call_members(pattern: str) -> list[str]:
    text = pattern.replace("$$$", "x")
    text = re.sub(r"\$([A-Za-z_][A-Za-z0-9_]*)", r"\1", text)
    try:
        tree = ast.parse(text, mode="eval")
    except SyntaxError:
        return []
    node = tree.body
    if not isinstance(node, ast.Call):
        return []
    members: list[str] = []
    cur = node.func
    while isinstance(cur, ast.Attribute):
        members.insert(0, cur.attr)
        cur = cur.value
    if isinstance(cur, ast.Name):
        members.insert(0, cur.id)
    return [m for m in members if not m.startswith("$")]


class _Analyzer(ast.NodeVisitor):
    def __init__(self, payload: dict[str, Any]):
        self.payload = payload
        self.root = Path(payload["repositoryRoot"]).resolve()
        self.spec = payload["changeSpec"]
        self.config = payload["config"]
        self.entries = payload["entryPoints"]
        self.graph: dict[str, Any] = {
            "schemaVersion": 1, "entryPoints": [], "nodes": [], "edges": [], "sinks": [], "affectedSites": [], "skipped": []
        }
        self.nodes: dict[str, dict[str, Any]] = {}
        roots = [r["pattern"] for r in self.spec["detection"]["taint_roots"] if r.get("language") == "py" and r.get("kind") == "call"]
        self.patterns = [_call_members(pattern) for pattern in roots]
        malformed = [pattern for pattern, members in zip(roots, self.patterns) if not members]
        if malformed:
            raise ValueError(f"unsupported taint-root pattern: {malformed[0]}")
        self.removed = [c.get("removed_path") or c.get("removed_symbol") or "" for c in self.spec["changes"]]
        self.ep: dict[str, Any] | None = None
        self.source = ""
        self.file = ""
        self.facts: dict[str, list[str]] = {}
        self.seq = 0

    def loc(self, node: ast.AST) -> dict[str, Any]:
        line = getattr(node, "lineno", 1)
        col = getattr(node, "col_offset", 0) + 1
        return {"file": _slash(str(Path(self.file).relative_to(self.root))), "line": line, "column": col, "endLine": getattr(node, "end_lineno", line)}

    def add_node(self, kind: str, node: ast.AST, label: str, path: str | None, confidence: str, basis: str) -> str:
        loc = self.loc(node)
        nid = _stable(kind, self.ep["id"], loc, path or "$", label)
        if nid not in self.nodes:
            rec = {
                "id": nid, "kind": kind, "entryPointId": self.ep["id"], "location": loc, "label": label[:240],
                "provenance": {
                    "confidence": confidence, "provider": self.spec["provider"], "specId": self.spec["id"],
                    "basis": basis, "evidenceRefs": [f"{loc['file']}:{loc['line']}:{loc['column']}"],
                },
            }
            if path:
                rec["path"] = path
            self.nodes[nid] = rec
            self.graph["nodes"].append(rec)
        return nid

    def analyze(self) -> dict[str, Any]:
        entries = []
        for raw in self.entries:
            file = _slash(str((self.root / raw["file"]).resolve().relative_to(self.root)))
            eid = _stable("ep", file, raw["export"], raw["kind"])
            ep = {"id": eid, "file": file, "export": raw["export"], "kind": raw["kind"], "language": "py"}
            entries.append(ep)
        entries.sort(key=lambda e: e["id"])
        self.graph["entryPoints"] = entries
        for ep in entries:
            self.ep = ep
            path = self.root / ep["file"]
            if not path.is_file():
                self.graph["skipped"].append({"file": ep["file"], "reason": "source_not_found"})
                continue
            self.file = str(path)
            self.source = path.read_text(encoding="utf-8")
            try:
                tree = ast.parse(self.source)
            except SyntaxError as error:
                self.graph["skipped"].append({"file": ep["file"], "reason": f"unsupported_syntax:{error.msg}"})
                continue
            self.facts = {}
            self._visit_module(tree, ep["export"])
        self.graph["nodes"].sort(key=lambda n: n["id"])
        self.graph["edges"].sort(key=lambda e: (e["from"], e["to"], e["pathSuffix"]))
        self.graph["sinks"].sort(key=lambda s: s["nodeId"])
        self.graph["affectedSites"].sort(key=lambda s: s["id"])
        return self.graph

    def _imports(self, tree: ast.AST) -> dict[str, str]:
        names: dict[str, str] = {}
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    names[alias.asname or alias.name.split(".")[0]] = alias.name.split(".")[0]
            elif isinstance(node, ast.ImportFrom) and node.module:
                root = node.module.split(".")[0]
                for alias in node.names:
                    names[alias.asname or alias.name] = f"{root}.{alias.name}"
        return names

    def _path_of(self, node: ast.AST) -> str | None:
        if isinstance(node, ast.Attribute):
            return node.attr
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            return node.value
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "get" and node.args:
            arg = node.args[0]
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                return arg.value
        if isinstance(node, ast.Subscript):
            sl = node.slice
            if isinstance(sl, ast.Constant) and isinstance(sl.value, str):
                return sl.value
        return None

    def _visit_module(self, tree: ast.AST, export: str):
        imports = self._imports(tree)
        fn = None
        for node in tree.body:
            if isinstance(node, ast.FunctionDef) and node.name == export:
                fn = node
                break
        if fn is None:
            self.graph["skipped"].append({"file": self.ep["file"], "reason": "unresolved_or_ignored"})
            return
        mocks = {m["module"].split(".")[-1]: m for m in self.config.get("mocks", []) if "exports" in m and "strategy" not in m}
        env: dict[str, dict[str, Any]] = {}
        for stmt in fn.body:
            self._stmt(stmt, imports, mocks, env)

    def _stmt(self, stmt: ast.AST, imports: dict[str, str], mocks: dict[str, Any], env: dict[str, dict[str, Any]]) -> None:
        if isinstance(stmt, ast.Assign) and len(stmt.targets) == 1 and isinstance(stmt.targets[0], ast.Name):
            env[stmt.targets[0].id] = self._expr(stmt.value, imports, mocks, env)
        elif isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name) and stmt.value:
            env[stmt.target.id] = self._expr(stmt.value, imports, mocks, env)
        elif isinstance(stmt, ast.Return) and stmt.value:
            value = self._expr(stmt.value, imports, mocks, env)
            if value.get("nodeId"):
                sid = self.add_node("sink", stmt, "return", value.get("path"), value.get("confidence", "medium"), "name_heuristic")
                self.graph["sinks"].append({"nodeId": sid, "kind": "returned_state", "name": "return", "location": self.loc(stmt)})
        elif isinstance(stmt, ast.Expr):
            self._expr(stmt.value, imports, mocks, env)
        elif isinstance(stmt, ast.If):
            for inner in stmt.body + stmt.orelse:
                self._stmt(inner, imports, mocks, env)

    def _expr(self, node: ast.AST, imports: dict[str, str], mocks: dict[str, Any], env: dict[str, dict[str, Any]]) -> dict[str, Any]:
        if isinstance(node, ast.Name):
            return env.get(node.id, {"path": None, "taint": False, "confidence": "low"})
        if isinstance(node, ast.Attribute):
            base = self._expr(node.value, imports, mocks, env)
            path = node.attr
            info = {**base, "path": path}
            if path in self.removed and base.get("taint"):
                info["hit"] = True
            return info
        if isinstance(node, ast.Subscript):
            base = self._expr(node.value, imports, mocks, env)
            path = self._path_of(node) or base.get("path")
            return {**base, "path": path, "taint": True, "confidence": "high" if base.get("taint") else "medium"}
        if isinstance(node, ast.Call):
            return self._call(node, imports, mocks, env)
        if isinstance(node, ast.Dict):
            merged: dict[str, Any] = {"path": None, "taint": False, "confidence": "low"}
            for key, val in zip(node.keys, node.values):
                child = self._expr(val, imports, mocks, env)
                if child.get("taint"):
                    merged = child
            return merged
        return {"path": self._path_of(node), "taint": False, "confidence": "low"}

    def _matches_pattern(self, func: ast.AST, imports: dict[str, str]) -> bool:
        members: list[str] = []
        cur = func
        while isinstance(cur, ast.Attribute):
            members.insert(0, cur.attr)
            cur = cur.value
        if isinstance(cur, ast.Name):
            members.insert(0, imports.get(cur.id, cur.id).split(".")[-1] if cur.id in imports else cur.id)
        for pattern in self.patterns:
            if pattern and members[-len(pattern):] == pattern[-len(pattern):]:
                return True
            if pattern and members and members[-1] == pattern[-1]:
                return True
        return False

    def _call(self, node: ast.Call, imports: dict[str, str], mocks: dict[str, Any], env: dict[str, dict[str, Any]]) -> dict[str, Any]:
        is_root = self._matches_pattern(node.func, imports)
        args = [self._expr(a, imports, mocks, env) for a in node.args]
        kw = {kw.arg: self._expr(kw.value, imports, mocks, env) for kw in node.keywords if kw.arg}
        taint = is_root or any(a.get("taint") for a in args) or any(v.get("taint") for v in kw.values())
        path = next((v.get("path") for v in list(kw.values()) + args if v.get("path")), None)
        info: dict[str, Any] = {"path": path, "taint": taint, "confidence": "high" if is_root else ("medium" if taint else "low")}
        nid = None
        if is_root:
            nid = self.add_node("taint_root", node, ast.unparse(node.func) if hasattr(ast, "unparse") else "call", path, "high", "provider_call")
            info["nodeId"] = nid
        name = None
        mock_key = ""
        func = node.func
        if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name):
            imported = imports.get(func.value.id, func.value.id)
            mock_key = imported.split(".")[0]
            name = f"{func.value.id}.{func.attr}"
        elif isinstance(func, ast.Name):
            imported = imports.get(func.id, func.id)
            mock_key = imported.split(".")[0]
            name = func.id
        mock = mocks.get(mock_key) or mocks.get(name.split(".")[0] if name else "")
        if mock and name:
            sid = self.add_node("sink", node, name, path, "high" if taint else "medium", "provider_call" if is_root else "name_heuristic")
            self.graph["sinks"].append({"nodeId": sid, "kind": mock["sinkKind"], "name": name, "location": self.loc(node)})
            if nid:
                self.graph["edges"].append({"from": nid, "to": sid, "kind": "flows_to", "pathSuffix": path or ""})
            if taint:
                for index, removed in enumerate(self.removed):
                    hit = removed and (path == removed or removed in kw or any(a.get("path") == removed for a in args) or any(k == removed for k in kw))
                    if hit or is_root:
                        site = _stable("site", self.ep["id"], sid, index)
                        self.graph["affectedSites"].append({
                            "id": site, "entryPointId": self.ep["id"], "nodeId": nid or sid, "specId": self.spec["id"],
                            "changeIndex": index, "location": self.loc(node), "sinkNodeIds": [sid],
                            "provenance": self.nodes[nid or sid]["provenance"],
                        })
                        break
        elif is_root:
            for index, removed in enumerate(self.removed):
                if removed and (removed in kw or path == removed):
                    bind = self.add_node("binding", node, removed, removed, "high", "provider_call")
                    self.graph["affectedSites"].append({
                        "id": _stable("site", self.ep["id"], bind, index), "entryPointId": self.ep["id"],
                        "nodeId": bind, "specId": self.spec["id"], "changeIndex": index, "location": self.loc(node),
                        "sinkNodeIds": [], "provenance": self.nodes[nid]["provenance"],
                    })
        return info


def resolve(payload: dict[str, Any]) -> dict[str, Any]:
    return _Analyzer(payload).analyze()
