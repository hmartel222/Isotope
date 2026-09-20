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
            if not any(node["entryPointId"] == ep["id"] and node["kind"] == "taint_root" for node in self.graph["nodes"]):
                self._visit_reachable_modules(path, tree)
        self.graph["nodes"].sort(key=lambda n: n["id"])
        self.graph["edges"].sort(key=lambda e: (e["from"], e["to"], e["pathSuffix"]))
        self.graph["sinks"].sort(key=lambda s: s["nodeId"])
        self.graph["affectedSites"].sort(key=lambda s: s["id"])
        return self.graph

    def _local_imports(self, current: Path, tree: ast.AST) -> list[Path]:
        paths: set[Path] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                if node.level:
                    base = current.parent
                    for _ in range(max(0, node.level - 1)):
                        base = base.parent
                    parts = node.module.split(".") if node.module else []
                    candidate = base.joinpath(*parts)
                elif node.module:
                    candidate = self.root.joinpath(*node.module.split("."))
                else:
                    continue
                choices = [candidate.with_suffix(".py"), candidate / "__init__.py"]
                if not node.module:
                    choices.extend(base / f"{alias.name}.py" for alias in node.names)
                paths.update(path.resolve() for path in choices if path.is_file())
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    candidate = self.root.joinpath(*alias.name.split("."))
                    for path in (candidate.with_suffix(".py"), candidate / "__init__.py"):
                        if path.is_file():
                            paths.add(path.resolve())
        return sorted(paths)

    def _visit_reachable_modules(self, entry_path: Path, entry_tree: ast.AST) -> None:
        modules = self._collect_modules(entry_path, entry_tree)
        functions: dict[str, tuple[ast.FunctionDef | ast.AsyncFunctionDef, Path, str, str | None]] = {}
        imports: dict[str, dict[str, str]] = {}
        trees: dict[str, ast.AST] = {}
        for path, tree in modules.items():
            module = self._module_name(path)
            trees[module] = tree
            imports[module] = self._resolved_imports(path, tree)
            for statement in getattr(tree, "body", []):
                if isinstance(statement, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    functions[f"{module}.{statement.name}"] = (statement, path, module, None)
                elif isinstance(statement, ast.ClassDef):
                    for member in statement.body:
                        if isinstance(member, (ast.FunctionDef, ast.AsyncFunctionDef)):
                            functions[f"{module}.{statement.name}.{member.name}"] = (member, path, module, f"{module}.{statement.name}")
        sink_targets: dict[str, tuple[str, str]] = {}
        for mock in self.config.get("mocks", []):
            if mock.get("adapter") != "method-record":
                continue
            for exported in (mock.get("exports") or {}):
                sink_targets[f"{mock['module']}.{exported}"] = (mock["sinkKind"], f"{mock['module'].split('.')[-1]}.{exported.split('.')[-1]}")
        context = {"functions": functions, "imports": imports, "trees": trees, "sinks": sink_targets, "stack": []}
        entry_key = f"{self._module_name(entry_path)}.{self.ep['export']}"
        if entry_key not in functions:
            self.graph["skipped"].append({"file": self.ep["file"], "reason": "unresolved_or_ignored"})
            return
        self._trace_function(entry_key, [], {}, context, 0)

    def _collect_modules(self, entry_path: Path, entry_tree: ast.AST) -> dict[Path, ast.AST]:
        pending: list[tuple[Path, ast.AST]] = [(entry_path.resolve(), entry_tree)]
        modules: dict[Path, ast.AST] = {}
        while pending and len(modules) < 200:
            path, tree = pending.pop(0)
            if path in modules:
                continue
            modules[path] = tree
            for imported in self._local_imports(path, tree):
                if imported in modules or any(candidate == imported for candidate, _ in pending):
                    continue
                try:
                    pending.append((imported, ast.parse(imported.read_text(encoding="utf-8"))))
                except (OSError, SyntaxError) as error:
                    self.graph["skipped"].append({"file": _slash(str(imported.relative_to(self.root))), "reason": f"unsupported_syntax:{error}"})
        if pending:
            self.graph["skipped"].append({"file": self.ep["file"], "reason": "file_limit:200"})
        return modules

    def _module_name(self, path: Path) -> str:
        relative = path.resolve().relative_to(self.root).with_suffix("")
        parts = list(relative.parts)
        if parts and parts[-1] == "__init__":
            parts.pop()
        return ".".join(parts)

    def _resolved_imports(self, path: Path, tree: ast.AST) -> dict[str, str]:
        names: dict[str, str] = {}
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    names[alias.asname or alias.name.split(".")[0]] = alias.name
            elif isinstance(node, ast.ImportFrom):
                if node.level:
                    base = path.parent
                    for _ in range(max(0, node.level - 1)):
                        base = base.parent
                    candidate = base.joinpath(*(node.module.split(".") if node.module else []))
                    module_path = candidate.with_suffix(".py") if candidate.with_suffix(".py").is_file() else candidate / "__init__.py"
                    module = self._module_name(module_path) if module_path.is_file() else ".".join(candidate.relative_to(self.root).parts)
                else:
                    module = node.module or ""
                for alias in node.names:
                    if alias.name != "*":
                        names[alias.asname or alias.name] = f"{module}.{alias.name}" if module else alias.name
        return names

    @staticmethod
    def _merge_info(values: list[dict[str, Any]]) -> dict[str, Any]:
        roots = sorted({root for value in values for root in value.get("roots", [])})
        confidence = "high" if any(value.get("confidence") == "high" for value in values) else ("medium" if roots else "low")
        types = {value.get("type") for value in values if value.get("type")}
        paths = {value.get("path") for value in values if value.get("path")}
        return {"taint": bool(roots), "roots": roots, "confidence": confidence,
                "type": next(iter(types)) if len(types) == 1 else None,
                "path": next(iter(paths)) if len(paths) == 1 else None}

    def _annotation_type(self, annotation: ast.AST | None, module: str, imports: dict[str, str]) -> str | None:
        if isinstance(annotation, ast.Name):
            return imports.get(annotation.id, f"{module}.{annotation.id}")
        if isinstance(annotation, ast.Attribute):
            text = ast.unparse(annotation) if hasattr(ast, "unparse") else ""
            head, _, tail = text.partition(".")
            return f"{imports.get(head, head)}.{tail}" if tail else imports.get(head)
        return None

    def _trace_function(self, key: str, positional: list[dict[str, Any]], keywords: dict[str, dict[str, Any]], context: dict[str, Any], depth: int) -> dict[str, Any]:
        if depth > 8 or key in context["stack"]:
            diagnostic = {"file": self.ep["file"], "reason": "local_call_limit:8"}
            if diagnostic not in self.graph["skipped"]:
                self.graph["skipped"].append(diagnostic)
            return self._merge_info(positional + list(keywords.values()))
        record = context["functions"].get(key)
        if not record:
            return self._merge_info(positional + list(keywords.values()))
        function, path, module, class_name = record
        module_imports = context["imports"][module]
        env: dict[str, dict[str, Any]] = {}
        position = 0
        for parameter in function.args.args:
            if parameter.arg == "self" and class_name:
                env[parameter.arg] = {"taint": False, "roots": [], "confidence": "low", "type": class_name, "path": None}
                continue
            value = keywords.get(parameter.arg) or (positional[position] if position < len(positional) else {"taint": False, "roots": [], "confidence": "low", "path": None})
            position += 1
            annotation_type = self._annotation_type(parameter.annotation, module, module_imports)
            env[parameter.arg] = {**value, **({"type": annotation_type} if annotation_type else {})}
        previous_file = self.file
        self.file = str(path)
        context["stack"].append(key)
        returns = self._trace_statements(function.body, env, module, context, depth)
        context["stack"].pop()
        self.file = previous_file
        return self._merge_info(returns) if returns else {"taint": False, "roots": [], "confidence": "low", "path": None}

    def _trace_statements(self, statements: list[ast.stmt], env: dict[str, dict[str, Any]], module: str, context: dict[str, Any], depth: int) -> list[dict[str, Any]]:
        returns: list[dict[str, Any]] = []
        for statement in statements:
            if isinstance(statement, ast.Assign) and len(statement.targets) == 1 and isinstance(statement.targets[0], ast.Name):
                env[statement.targets[0].id] = self._trace_expr(statement.value, env, module, context, depth)
            elif isinstance(statement, ast.AnnAssign) and isinstance(statement.target, ast.Name) and statement.value:
                value = self._trace_expr(statement.value, env, module, context, depth)
                annotation_type = self._annotation_type(statement.annotation, module, context["imports"][module])
                env[statement.target.id] = {**value, **({"type": annotation_type} if annotation_type else {})}
            elif isinstance(statement, ast.Return):
                returns.append(self._trace_expr(statement.value, env, module, context, depth) if statement.value else {"taint": False, "roots": [], "confidence": "low", "path": None})
            elif isinstance(statement, ast.Expr):
                self._trace_expr(statement.value, env, module, context, depth)
            elif isinstance(statement, ast.If):
                returns.extend(self._trace_statements(statement.body, dict(env), module, context, depth))
                returns.extend(self._trace_statements(statement.orelse, dict(env), module, context, depth))
            elif isinstance(statement, ast.Try):
                returns.extend(self._trace_statements(statement.body, dict(env), module, context, depth))
                for handler in statement.handlers:
                    returns.extend(self._trace_statements(handler.body, dict(env), module, context, depth))
                returns.extend(self._trace_statements(statement.orelse, dict(env), module, context, depth))
                returns.extend(self._trace_statements(statement.finalbody, dict(env), module, context, depth))
        return returns

    def _call_target(self, function: ast.AST, env: dict[str, dict[str, Any]], module: str, imports: dict[str, str]) -> str | None:
        if isinstance(function, ast.Name):
            return imports.get(function.id, f"{module}.{function.id}")
        if isinstance(function, ast.Attribute):
            if isinstance(function.value, ast.Name):
                base = env.get(function.value.id, {}).get("type") or imports.get(function.value.id)
                return f"{base}.{function.attr}" if base else None
            text = ast.unparse(function) if hasattr(ast, "unparse") else ""
            head, _, tail = text.partition(".")
            if head in imports and tail:
                return f"{imports[head]}.{tail}"
        return None

    def _provider_call(self, node: ast.Call, module: str, context: dict[str, Any]) -> bool:
        provider_modules = [mock["module"] for mock in self.config.get("mocks", []) if "strategy" in mock]
        imported = context["imports"][module].values()
        if not any(any(name == provider or name.startswith(f"{provider}.") for name in imported) for provider in provider_modules):
            return False
        return self._matches_pattern(node.func, self._imports(context["trees"][module]))

    def _trace_expr(self, node: ast.AST | None, env: dict[str, dict[str, Any]], module: str, context: dict[str, Any], depth: int) -> dict[str, Any]:
        empty = {"taint": False, "roots": [], "confidence": "low", "path": None}
        if node is None:
            return empty
        if isinstance(node, ast.Name):
            return dict(env.get(node.id, empty))
        if isinstance(node, ast.Attribute):
            return {**self._trace_expr(node.value, env, module, context, depth), "path": node.attr}
        if isinstance(node, ast.Subscript):
            return {**self._trace_expr(node.value, env, module, context, depth), "path": self._path_of(node)}
        if isinstance(node, (ast.Dict, ast.List, ast.Tuple, ast.Set)):
            values = list(node.values) if isinstance(node, ast.Dict) else list(node.elts)
            return self._merge_info([self._trace_expr(value, env, module, context, depth) for value in values])
        if not isinstance(node, ast.Call):
            return empty
        positional = [self._trace_expr(argument, env, module, context, depth) for argument in node.args]
        keywords = {keyword.arg: self._trace_expr(keyword.value, env, module, context, depth) for keyword in node.keywords if keyword.arg}
        if self._provider_call(node, module, context):
            root = self.add_node("taint_root", node, ast.unparse(node.func) if hasattr(ast, "unparse") else "provider call", None, "high", "provider_call")
            return {"taint": True, "roots": [root], "confidence": "high", "path": None}
        target = self._call_target(node.func, env, module, context["imports"][module])
        if target in context["sinks"]:
            value = self._merge_info(positional + list(keywords.values()))
            if value["taint"]:
                sink_kind, sink_name = context["sinks"][target]
                sink = self.add_node("sink", node, sink_name, value.get("path"), value["confidence"], "one_hop_parameter")
                if not any(item["nodeId"] == sink for item in self.graph["sinks"]):
                    self.graph["sinks"].append({"nodeId": sink, "kind": sink_kind, "name": sink_name, "location": self.loc(node)})
                for root in value["roots"]:
                    edge = {"from": root, "to": sink, "kind": "flows_to", "pathSuffix": value.get("path") or ""}
                    if edge not in self.graph["edges"]:
                        self.graph["edges"].append(edge)
                    for index, _change in enumerate(self.spec["changes"]):
                        site = {"id": _stable("site", self.ep["id"], root, sink, index), "entryPointId": self.ep["id"],
                                "nodeId": root, "specId": self.spec["id"], "changeIndex": index,
                                "location": self.nodes[root]["location"], "sinkNodeIds": [sink],
                                "provenance": self.nodes[root]["provenance"]}
                        if not any(existing["id"] == site["id"] for existing in self.graph["affectedSites"]):
                            self.graph["affectedSites"].append(site)
            return empty
        if target in context["functions"]:
            return self._trace_function(target, positional, keywords, context, depth + 1)
        if target and any(key.startswith(f"{target}.") for key in context["functions"]):
            return {"taint": False, "roots": [], "confidence": "low", "type": target, "path": None}
        receiver = self._trace_expr(node.func.value, env, module, context, depth) if isinstance(node.func, ast.Attribute) else empty
        return self._merge_info([receiver, *positional, *keywords.values()])

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
        mocks = {m["module"].split(".")[-1]: m for m in self.config.get("mocks", []) if "exports" in m and "strategy" not in m and m.get("adapter") != "method-record"}
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
