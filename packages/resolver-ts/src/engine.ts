import { envelopePrefixFor } from '@isotope/providers';
import { createHash } from 'node:crypto';
import { relative } from 'node:path';
import type { BDG, BDGNode, ChangeSpec, Confidence, EntryPoint, IsotopeConfig, Provenance, SinkKind } from '@isotope/core';
import { localFile, slash, type LoadedProject } from './project';
import { callPatterns, normalized, parsePath, pathText, samePath } from './paths';
import type { Syntax } from './syntax';

interface Fact { node: string; path: string[]; provenance: Provenance; cast?: boolean; uncertain?: boolean; aggregation?: boolean }
interface Reference { kind: 'provider' | 'mock' | 'http' | 'response' | 'function' | 'namespace'; name: string; tail: string[]; confidence: Confidence; fn?: Syntax; file?: string; hops?: number; closure?: Environment }
interface Value { facts: Fact[]; ref?: Reference; fields?: Map<string, Value> }
type Environment = Map<string, Value>;
interface Frame { env: Environment; depth: number; context: string; entry: boolean; file: string; moduleHops: number }
interface Flow { frame: Frame; returns: Value[]; stopped: boolean }
const empty = (): Value => ({ facts: [] });
const rank: Record<Confidence, number> = { high: 2, medium: 1, low: 0 };
const weaker = (a: Confidence, b: Confidence): Confidence => rank[a] < rank[b] ? a : b;
export const stableId = (kind: string, ...parts: unknown[]): string => `${kind}_${createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 20)}`;
function union(values: Value[]): Value {
  const facts = new Map<string, Fact>();
  for (const value of values) for (const f of value.facts) facts.set(JSON.stringify(f), f);
  return { facts: [...facts.values()] };
}
function joinValues(values: Value[]): Value {
  const first = values[0];
  if (!first) return empty();
  if (values.every(v => v === first)) return first;
  const fields = values.every(v => v.fields) ? new Map([...new Set(values.flatMap(v => [...v.fields!.keys()]))].map(key => [key, joinValues(values.map(v => v.fields!.get(key) ?? empty()))])) : undefined;
  return { ...union(values), ...(fields ? { fields } : {}), ...(first.ref && values.every(v => v.ref === first.ref) ? { ref: first.ref } : {}) };
}
/** Facts nested inside a constructed object must cross the same bindings/call boundaries. */
function mapFacts(value: Value, map: (fact: Fact) => Fact, mapRef?: (ref: Reference) => Reference): Value {
  return { ...value, facts: value.facts.map(map), ...(value.fields ? { fields: new Map([...value.fields].map(([key, field]) => [key, mapFacts(field, map, mapRef)])) } : {}),
    ...(value.ref && mapRef ? { ref: mapRef(value.ref) } : {}) };
}
function boundNames(pattern: Syntax): string[] {
  if (pattern.k === 'id') return [pattern.text!];
  if (pattern.k === 'variable') return pattern.a ? boundNames(pattern.a) : [];
  if (pattern.k === 'property') return pattern.b ? boundNames(pattern.b) : [];
  return (pattern.items ?? []).flatMap(boundNames);
}

export class Analyzer {
  readonly graph: BDG;
  private readonly patterns: string[][];
  private readonly changes: { removed: string[]; replacement: string[] }[];
  private readonly envelopePrefix: string[];
  private readonly nodes = new Map<string, BDGNode>();
  private readonly modules = new Map<string, Environment>();
  private readonly exports = new Map<string, Map<string, Value>>();
  private readonly visited = new Set<string>();
  private operations = 0;
  private ep!: EntryPoint;
  constructor(private project: LoadedProject, private spec: ChangeSpec, private config: IsotopeConfig, entries: EntryPoint[]) {
    this.patterns = callPatterns(spec);
    this.envelopePrefix = envelopePrefixFor(spec.provider);
    this.changes = spec.changes.map(c => ({ removed: parsePath(c.removed_path ?? c.removed_symbol ?? c.replacement.path), replacement: parsePath(c.replacement.path) }));
    this.graph = { schemaVersion: 1, entryPoints: entries, nodes: [], edges: [], sinks: [], affectedSites: [], skipped: [...project.diagnostics] };
  }
  private norm(path: string[]): string[] { return normalized(path, this.envelopePrefix); }
  private diagnostic(n: Syntax, reason: string): void { this.graph.skipped.push({ file: slash(relative(this.project.root, n.file)), reason }); }
  private location(n: Syntax): BDGNode['location'] {
    const text = this.project.sources.get(n.file)?.text ?? '';
    const before = text.slice(0, n.start); const last = before.lastIndexOf('\n');
    return { file: slash(relative(this.project.root, n.file)), line: before.split('\n').length, column: n.start - last, endLine: text.slice(0, n.end).split('\n').length };
  }
  private provenance(confidence: Confidence, basis: Provenance['basis'], n: Syntax): Provenance {
    const loc = this.location(n);
    return { confidence, basis, provider: this.spec.provider, specId: this.spec.id, evidenceRefs: [`${loc.file}:${loc.line}:${loc.column}`] };
  }
  private step(n: Syntax, kind: BDGNode['kind'], value: Value, label: string, frame: Frame, flags: Partial<Fact> = {}): Value {
    const groups = new Map<string, Fact[]>();
    for (const f of value.facts) { const key = JSON.stringify(f.path); groups.set(key, [...(groups.get(key) ?? []), f]); }
    const facts: Fact[] = [];
    for (const list of groups.values()) {
      const first = list[0]!;
      const confidence = list.reduce((c, f) => weaker(c, f.provenance.confidence), first.provenance.confidence);
      const provenance = { ...first.provenance, confidence };
      const path = flags.path ?? first.path;
      const id = stableId(kind, this.ep.id, this.location(n), path, label, frame.context);
      const fact: Fact = { ...first, ...flags, path, provenance: flags.provenance ?? provenance, node: id,
        cast: flags.cast || list.some(f => f.cast), uncertain: flags.uncertain || list.some(f => f.uncertain), aggregation: flags.aggregation || list.some(f => f.aggregation) };
      const node: BDGNode = { id, kind, entryPointId: this.ep.id, location: this.location(n), label: label.slice(0, 240), provenance: fact.provenance,
        ...(path.length ? { path: pathText(this.norm(path)) || '$' } : {}), ...(fact.cast ? { castSuppressed: true } : {}), ...(fact.uncertain ? { indeterminatePath: true } : {}), ...(fact.aggregation ? { aggregation: true } : {}) };
      const existing = this.nodes.get(id);
      if (existing) { node.provenance.confidence = weaker(existing.provenance.confidence, node.provenance.confidence); }
      this.nodes.set(id, node);
      for (const f of list) if (f.node !== id) this.graph.edges.push({ from: f.node, to: id, kind: 'flows_to', pathSuffix: pathText(path) });
      facts.push(fact);
    }
    const byPath = new Map(facts.map(f => [JSON.stringify(f.path), f]));
    return mapFacts(value, f => byPath.get(JSON.stringify(f.path)) ?? f);
  }
  private root(n: Syntax, confidence: Confidence, basis: Provenance['basis'], frame: Frame): Value {
    const id = stableId('taint_root', this.ep.id, this.location(n), basis, frame.context);
    const provenance = { ...this.provenance(confidence, basis, n), rootNodeId: id };
    this.nodes.set(id, { id, kind: 'taint_root', entryPointId: this.ep.id, location: this.location(n), label: basis, provenance });
    return { facts: [{ node: id, path: [], provenance }] };
  }
  private access(n: Syntax, value: Value, segment: string, frame: Frame): Value {
    if (value.fields) return segment === '?' || segment === '*' ? union([...value.fields.values()]) : value.fields.get(segment) ?? empty();
    let ref = value.ref ? { ...value.ref, tail: [...value.ref.tail, segment] } : undefined;
    if (ref?.kind === 'namespace' && ref.file) return this.imported(ref.file, segment, ref.hops ?? 0);
    const facts = value.facts.map(f => ({ ...f, path: [...f.path, segment], ...(segment === '?' ? { uncertain: true, provenance: { ...f.provenance, confidence: 'low' as const } } : {}) }));
    const out: Value = { facts, ...(ref ? { ref } : {}) };
    if (segment === '?' && facts.length) this.diagnostic(n, 'indeterminate_path:dynamic_key');
    // Materialize only changed/replacement reads, not every property token.
    const matched = facts.filter(f => !f.uncertain && this.changes.some(c => samePath(this.norm(f.path), c.removed) || samePath(this.norm(f.path), c.replacement)));
    if (!matched.length) return out;
    const read = this.step(n, 'binding', { facts: matched }, 'provider field read', frame);
    for (const f of read.facts) for (const [changeIndex, c] of this.changes.entries()) {
      if (!samePath(this.norm(f.path), c.removed) && !samePath(this.norm(f.path), c.replacement)) continue;
      this.graph.affectedSites.push({ id: stableId('site', f.node, changeIndex), entryPointId: this.ep.id, nodeId: f.node, specId: this.spec.id, changeIndex, location: this.location(n), sinkNodeIds: [], provenance: f.provenance });
    }
    return { ...out, facts: [...facts.filter(f => !matched.includes(f)), ...read.facts] };
  }
  private imported(file: string, name: string, hops: number): Value {
    if (hops > 1) return empty();
    this.module(file, hops);
    const value = this.exports.get(file)?.get(name) ?? empty();
    if (value.ref?.kind === 'provider') {
      if (value.ref.hops) return empty();
      return { ...value, ref: { ...value.ref, confidence: weaker(value.ref.confidence, 'medium'), hops: 1 } };
    }
    return value;
  }
  private module(file: string, hops = 0): Environment {
    const cached = this.modules.get(file); if (cached) return cached;
    const env: Environment = new Map(); this.modules.set(file, env); this.exports.set(file, new Map());
    const source = this.project.sources.get(file); if (!source) return env;
    const frame: Frame = { env, depth: 0, context: `module:${slash(relative(this.project.root, file))}`, entry: false, file, moduleHops: hops };
    const statements = source.statements.flatMap(s => s.k === 'block' ? s.items ?? [] : [s]);
    for (const n of statements) if (n.k === 'function' && n.text) env.set(n.text, this.evaluate(n, frame));
    for (const n of statements) {
      if (n.k === 'import') for (const binding of n.items ?? []) {
        const name = n.text!; const exported = binding.op!;
        let value = this.external(name, exported);
        const target = this.project.resolveImport(file, name);
        if (!value.ref && target) value = this.external(target, exported);
        if (!value.ref && target) {
          if (hops >= 1) this.diagnostic(n, 'reexport_limit:1');
          else value = exported === '*' ? { facts: [], ref: { kind: 'namespace', name, tail: [], confidence: 'medium', file: target, hops: hops + 1 } } : this.imported(target, exported, hops + 1);
        }
        env.set(binding.text!, value);
      }
      if (n.k === 'variable') this.bind(n.a!, this.initializer(n, frame), frame);
      if (n.exported) this.exports.get(file)!.set(n.exported, n.k === 'function' ? env.get(n.text!) ?? this.evaluate(n, frame) : env.get(n.a?.text ?? '') ?? empty());
      if (n.k === 'exportDefault') this.exports.get(file)!.set('default', this.evaluate(n.a!, frame));
      if (n.k === 'export') for (const s of n.items ?? []) {
        const target = n.text ? this.project.resolveImport(file, n.text) : undefined;
        if (target && hops >= 1) this.diagnostic(n, 'reexport_limit:1');
        this.exports.get(file)!.set(s.text!, target ? (hops < 1 ? this.imported(target, s.op!, hops + 1) : empty()) : env.get(s.op!) ?? empty());
      }
      // CommonJS exports are declarations, not executed module statements.
      if (n.k === 'expression' && n.a?.k === 'binary' && n.a.op === '=') {
        const chain = this.chain(n.a.a!);
        if (chain && (chain[0] === 'exports' || (chain[0] === 'module' && chain[1] === 'exports'))) {
          const name = chain[0] === 'exports' ? chain[1] : chain[2];
          this.exports.get(file)!.set(name ?? 'default', this.evaluate(n.a.b!, frame));
        }
      }
    }
    return env;
  }
  private external(module: string, name: string): Value {
    if (this.spec.detection.ecosystems.npm?.packages.includes(module)) return { facts: [], ref: { kind: 'provider', name: module, tail: name === '*' || name === 'default' ? [] : [name], confidence: 'high' } };
    for (const mock of this.config.mocks) {
      if ('strategy' in mock) continue;
      const configured = localFile(this.project.root, mock.module);
      if (mock.module === module || (configured && configured === module)) {
        if (name === '*') return { facts: [], ref: { kind: 'mock', name: module, tail: [], confidence: 'high' } };
        if (Object.hasOwn(mock.exports, name)) return { facts: [], ref: { kind: 'mock', name: module, tail: [name], confidence: 'high' } };
      }
    }
    if (module === 'axios') return { facts: [], ref: { kind: 'http', name: 'axios', tail: name === 'default' || name === '*' ? [] : [name], confidence: 'high' } };
    return empty();
  }
  private chain(n: Syntax): string[] | undefined {
    if (n.k === 'id') return [n.text!];
    if (n.k === 'member' && n.a && n.b && (n.op === 'exact' || n.b.k === 'literal')) { const parent = this.chain(n.a); return parent ? [...parent, n.b.text!] : undefined; }
    return undefined;
  }
  private bind(pattern: Syntax, value: Value, frame: Frame): void {
    if (pattern.k === 'id') { frame.env.set(pattern.text!, this.step(pattern, 'binding', value, `binding ${pattern.text}`, frame)); return; }
    if (pattern.k === 'variable') { this.bind(pattern.a!, value, frame); return; }
    if (pattern.k === 'objectPattern' || pattern.k === 'arrayPattern') {
      for (const p of pattern.items ?? []) {
        if (p.op === 'rest') { this.diagnostic(p, 'unsupported_destructuring_rest'); continue; }
        const key = pattern.k === 'arrayPattern' ? '*' : p.a?.text;
        if (!key) { this.diagnostic(p, 'unsupported_destructuring_key'); continue; }
        this.bind(p.b ?? p, this.access(p, value, key, frame), frame);
      }
    }
  }
  private initializer(n: Syntax, frame: Frame): Value {
    let value = n.b ? this.evaluate(n.b, frame) : empty();
    if (!value.facts.length && n.providerType && value.ref?.kind !== 'provider') {
      value = this.root(n, frame.depth ? 'medium' : 'high', 'provider_type', frame);
      if (n.b?.k === 'cast') value.facts = value.facts.map(f => ({ ...f, cast: true }));
    }
    return value;
  }
  private sink(n: Syntax, value: Value, kind: SinkKind, name: string, frame: Frame): void {
    if (!value.facts.length) return;
    // One static boundary node per call site, even when several provider fields reach it.
    const provenance = value.facts.reduce((p, f) => rank[f.provenance.confidence] < rank[p.confidence] ? f.provenance : p, value.facts[0]!.provenance);
    const id = stableId('sink', this.ep.id, this.location(n), kind, name, frame.context);
    this.nodes.set(id, { id, kind: 'sink', entryPointId: this.ep.id, location: this.location(n), label: name, provenance,
      ...(value.facts.some(f => f.cast) ? { castSuppressed: true } : {}), ...(value.facts.some(f => f.uncertain) ? { indeterminatePath: true } : {}), ...(value.facts.some(f => f.aggregation) ? { aggregation: true } : {}) });
    this.graph.sinks.push({ nodeId: id, name, kind, location: this.location(n) });
    for (const f of value.facts) this.graph.edges.push({ from: f.node, to: id, kind: 'flows_to', pathSuffix: pathText(f.path) });
  }
  private evaluate(n: Syntax, frame: Frame): Value {
    if (++this.operations > 30000) { this.diagnostic(n, 'analysis_budget:30000'); return empty(); }
    const ev = (node: Syntax | undefined) => node ? this.evaluate(node, frame) : empty();
    switch (n.k) {
      case 'id': return frame.env.get(n.text!) ?? empty();
      case 'literal': case 'noop': return empty();
      case 'function': return { facts: [], ref: { kind: 'function', name: n.text ?? '', tail: [], confidence: 'high', fn: n, file: n.file, closure: frame.env } };
      case 'unwrap': return ev(n.a);
      case 'cast': return mapFacts(ev(n.a), f => ({ ...f, cast: true }));
      case 'member': {
        const base = ev(n.a); const literal = n.b?.k === 'literal';
        let segment = n.op === 'exact' || (literal && n.b?.op === 'string') ? n.b!.text! : literal && n.b?.op === 'number' ? '*' : '?';
        // A dynamic index is a wildcard only when the current path is a known array prefix in the ChangeSpec.
        if (segment === '?' && base.facts.length && base.facts.every(f => this.changes.some(c => [c.removed, c.replacement].some(p => samePath(this.norm(f.path), p.slice(0, this.norm(f.path).length)) && p[this.norm(f.path).length] === '*')))) segment = '*';
        return this.access(n, base, segment, frame);
      }
      case 'object': {
        const fields = new Map<string, Value>(); const values: Value[] = [];
        let complete = true;
        for (const p of n.items ?? []) {
          const v = ev(p.k === 'property' ? p.b : p); values.push(v);
          if (p.k === 'property' && p.a?.text) fields.set(p.a.text, v);
          else if (p.k === 'unwrap' && v.fields) for (const [key, field] of v.fields) fields.set(key, field);
          else { complete = false; this.diagnostic(p, 'unsupported_object_shape'); }
        }
        return complete ? { ...union([...fields.values()]), fields } : union(values);
      }
      case 'array': return union((n.items ?? []).map(ev));
      case 'conditional': {
        this.step(n.a!, 'branch', ev(n.a), 'conditional', frame);
        const left = { ...frame, env: new Map(frame.env) }; const right = { ...frame, env: new Map(frame.env) };
        const values = [n.b ? this.evaluate(n.b, left) : empty(), n.c ? this.evaluate(n.c, right) : empty()];
        for (const name of frame.env.keys()) frame.env.set(name, joinValues([left.env.get(name) ?? empty(), right.env.get(name) ?? empty()]));
        return joinValues(values);
      }
      case 'binary': {
        if (n.op === '=') { const value = ev(n.b); if (n.a?.k === 'id') this.bind(n.a, value, frame); else this.diagnostic(n, 'unsupported_property_assignment'); return value; }
        if (['&&','||','??'].includes(n.op ?? '')) {
          const left = ev(n.a); const conditional = { ...frame, env: new Map(frame.env) };
          const right = n.b ? this.evaluate(n.b, conditional) : empty();
          this.step(n, 'branch', left, n.op!, frame);
          for (const name of frame.env.keys()) frame.env.set(name, joinValues([frame.env.get(name)!, conditional.env.get(name) ?? empty()]));
          return joinValues([left, right]);
        }
        if (n.op?.endsWith('=') && !['===', '!==', '==', '!=', '>=', '<='].includes(n.op)) {
          const value = this.step(n, 'transform', union([ev(n.a), ev(n.b)]), n.op, frame); if (n.a?.k === 'id') this.bind(n.a, value, frame); return value;
        }
        return this.step(n, 'transform', union([ev(n.a), ev(n.b)]), n.op ?? 'binary', frame);
      }
      case 'template': return this.step(n, 'transform', union((n.items ?? []).map(ev)), 'template', frame);
      case 'unary': return this.step(n, 'transform', ev(n.a), n.op ?? 'unary', frame);
      case 'new': { const ctor = ev(n.a); if (ctor.ref?.kind === 'provider') return { facts: [], ref: { ...ctor.ref, tail: [] } }; return this.step(n, 'transform', union((n.items ?? []).map(ev)), `new ${this.chain(n.a!)?.join('.') ?? 'unknown'}`, frame); }
      case 'call': return this.call(n, frame);
      case 'unsupported': this.diagnostic(n, `unsupported_syntax:${n.text}`); return empty();
      default: return empty();
    }
  }
  private call(n: Syntax, frame: Frame): Value {
    const chain = this.chain(n.a!); const callee = this.evaluate(n.a!, frame); const ref = callee.ref;
    if (chain?.length === 1 && chain[0] === 'require' && !frame.env.has('require') && n.items?.length === 1 && n.items[0]?.k === 'literal') {
      const module = n.items[0].text!; const target = this.project.resolveImport(n.file, module);
      let value = this.external(module, '*');
      if (!value.ref && target) value = this.external(target, '*');
      if (!value.ref && target && frame.moduleHops >= 1) { this.diagnostic(n, 'reexport_limit:1'); return empty(); }
      return value.ref ? value : target ? { facts: [], ref: { kind: 'namespace', name: module, tail: [], confidence: 'medium', file: target, hops: 1 } } : empty();
    }
    if (ref?.kind === 'provider' && this.patterns.some(p => samePath(ref.tail, p))) {
      const confidence = this.project.sources.get(n.file)?.fallback || frame.depth ? weaker(ref.confidence, 'medium') : ref.confidence;
      return this.root(n, confidence, ref.hops ? 'reexport' : 'provider_call', frame);
    }
    if (ref?.kind === 'provider') {
      return { facts: [], ref: { kind: 'provider', name: ref.name, tail: [], confidence: ref.confidence, ...(ref.hops ? { hops: ref.hops } : {}) } };
    }
    const args = (n.items ?? []).map(a => this.evaluate(a, frame)); const argumentValue = union(args);
    if (ref?.kind === 'mock') {
      const mock = this.config.mocks.find(m => !('strategy' in m) && (m.module === ref.name || localFile(this.project.root, m.module) === ref.name));
      if (mock && 'sinkKind' in mock && ref.tail.length && Object.hasOwn(mock.exports, ref.tail[0]!)) this.sink(n, argumentValue, mock.sinkKind, ref.tail.join('.'), frame);
      return empty();
    }
    if (ref?.kind === 'response') {
      if (['json', 'send', 'end'].includes(ref.tail.at(-1) ?? '')) this.sink(n, argumentValue, 'returned_state', 'response', frame);
      return { facts: [], ref: { ...ref, tail: [] } };
    }
    const global = (name: string) => chain?.[0] === name && !frame.env.has(name);
    if ((global('fetch') && chain?.length === 1) || (ref?.kind === 'http' && (ref.tail.length === 0 || ['get','post','put','patch','delete','request'].includes(ref.tail[0]!)))) {
      this.sink(n, argumentValue, 'http_out', ref ? [ref.name, ...ref.tail].join('.') : 'fetch', frame); return empty();
    }
    if ((global('console') || (chain?.[0] === 'logger' && !ref)) && ['log','info','debug','warn','error'].includes(chain?.at(-1) ?? '')) {
      this.sink(n, argumentValue, 'log_only', chain!.join('.'), frame); return empty();
    }
    const method = n.a?.k === 'member' ? n.a.b?.text : undefined;
    if (['map','reduce','sort'].includes(method ?? '') && n.a?.a) {
      const receiver = this.evaluate(n.a.a, frame); const callback = n.items?.[0]; let mapped = receiver;
      if (callback?.k === 'function' && receiver.facts.length) {
        const element = this.access(callback, receiver, '*', frame);
        const parameters = method === 'reduce' ? [union([args[1] ?? empty(), element]), element] : [element];
        mapped = this.invoke(callback, parameters, frame, false, n.start, frame.env);
      } else if (method !== 'sort' && receiver.facts.length) this.diagnostic(n, 'unsupported_collection_callback');
      return this.step(n, 'transform', union([mapped, method === 'sort' ? receiver : empty()]), method!, frame, { aggregation: true });
    }
    if (global('Math') && ['max','min'].includes(chain?.[1] ?? '')) return this.step(n, 'transform', argumentValue, chain!.join('.'), frame, { aggregation: true });
    if (['String','Number','Boolean','Date'].some(global) && chain?.length === 1) return this.step(n, 'transform', argumentValue, chain[0]!, frame);
    if (ref?.kind === 'function' && ref.fn) {
      if (frame.depth >= 1) { this.diagnostic(n, 'local_call_limit:1'); return empty(); }
      const passed = args.map(a => this.step(n, 'local_call', a, ref.name || 'local function', frame));
      return this.invoke(ref.fn, passed, frame, true, n.start, ref.closure);
    }
    if (argumentValue.facts.length || callee.facts.length) this.diagnostic(n, 'unsupported_call');
    return empty();
  }
  private invoke(fn: Syntax, args: Value[], parent: Frame, hop: boolean, callStart: number, closure?: Environment): Value {
    const env = new Map(closure ?? this.module(fn.file));
    // Same-file closures retain lexical facts; imported helpers use their own module bindings.
    const frame: Frame = { env, depth: parent.depth + (hop ? 1 : 0), context: `${parent.context}/${callStart}:${fn.start}`, entry: false, file: fn.file, moduleHops: parent.moduleHops };
    for (const [i, p] of (fn.params ?? []).entries()) {
      let value = args[i] ?? empty();
      if (!value.facts.length && p.providerType) value = this.root(p, hop ? 'medium' : 'high', 'provider_type', frame);
      if (hop) value = mapFacts(value, f => ({ ...f, provenance: { ...f.provenance, confidence: weaker(f.provenance.confidence, 'medium'), basis: 'one_hop_parameter' } }), ref => ({ ...ref, confidence: weaker(ref.confidence, 'medium') }));
      this.bind(p.a ?? p, value, frame);
    }
    if (fn.a?.k !== 'block') return fn.a ? this.evaluate(fn.a, frame) : empty();
    return joinValues(this.run(fn.a.items ?? [], frame));
  }
  /** Statement worklist with explicit state snapshots and joins; loops widen after one pass. */
  private run(statements: Syntax[], frame: Frame): Value[] {
    const flow: Flow = { frame, returns: [], stopped: false };
    type Task = { node?: Syntax; flow: Flow; join?: () => void };
    const queue: Task[] = statements.map(node => ({ node, flow }));
    const schedule = (nodes: Syntax[], target: Flow) => {
      for (const n of nodes) if (n.k === 'function' && n.text) target.frame.env.set(n.text, this.evaluate(n, target.frame));
      queue.unshift(...nodes.map(node => ({ node, flow: target })));
    };
    for (const n of statements) if (n.k === 'function' && n.text) frame.env.set(n.text, this.evaluate(n, frame));
    while (queue.length && this.operations < 30000) {
      const task = queue.shift()!; if (task.join) { task.join(); continue; }
      const n = task.node!; const state = task.flow; if (state.stopped) continue;
      const f = state.frame;
      const fingerprint = stableId('visit', n.file, n.start, n.end, n.k, f.context, [...f.env].map(([k,v]) => [k,v.facts]));
      if (this.visited.has(fingerprint)) continue; this.visited.add(fingerprint);
      if (n.k === 'block') {
        if (n.op === 'declarations') { schedule(n.items ?? [], state); continue; }
        const nested: Flow = { frame: { ...f, env: new Map(f.env) }, returns: [], stopped: false };
        const locals = new Set((n.items ?? []).flatMap(s => s.op === 'declarations' ? (s.items ?? []).flatMap(boundNames) : s.k === 'function' ? [s.text] : []));
        queue.unshift({ flow: state, join: () => {
          for (const name of f.env.keys()) if (!locals.has(name)) f.env.set(name, nested.frame.env.get(name) ?? empty());
          state.returns.push(...nested.returns); state.stopped = nested.stopped;
        } });
        schedule(n.items ?? [], nested); continue;
      }
      if (n.k === 'variable') { this.bind(n.a!, this.initializer(n, f), f); continue; }
      if (n.k === 'expression') { this.evaluate(n.a!, f); continue; }
      if (n.k === 'return') { const value = n.a ? this.evaluate(n.a, f) : empty(); if (f.entry) this.sink(n, value, 'returned_state', 'return', f); state.returns.push(value); state.stopped = true; continue; }
      if (n.k === 'throw') { if (n.a) this.evaluate(n.a, f); state.stopped = true; continue; }
      if (n.k === 'if' || n.k === 'loop') {
        if (n.a) this.step(n.a, 'branch', this.evaluate(n.a, f), n.k, f);
        if (n.k === 'loop') this.diagnostic(n, 'loop_bound:one_iteration_join');
        if (n.k === 'loop' && n.c) this.diagnostic(n, 'unsupported_loop_header');
        const left: Flow = { frame: { ...f, env: new Map(f.env) }, returns: [], stopped: false };
        const right: Flow = { frame: { ...f, env: new Map(f.env) }, returns: [], stopped: false };
        queue.unshift({ flow: state, join: () => {
          for (const name of f.env.keys()) {
            const values = [left, right].filter(s => !s.stopped).map(s => s.frame.env.get(name) ?? empty());
            if (values.length) f.env.set(name, joinValues(values));
          }
          state.returns.push(...left.returns, ...right.returns); state.stopped = left.stopped && right.stopped;
        } });
        if (n.k === 'if' && n.c) schedule([n.c], right);
        if (n.b) schedule([n.b], left);
        continue;
      }
      if (!['function','noop'].includes(n.k)) this.diagnostic(n, `unsupported_statement:${n.text ?? n.k}`);
    }
    if (queue.length) this.diagnostic(statements[0]!, 'analysis_budget:30000');
    return flow.returns;
  }
  analyze(): BDG {
    for (const ep of this.graph.entryPoints) {
      this.ep = ep; this.modules.clear(); this.exports.clear(); this.visited.clear(); this.operations = 0;
      const file = localFile(this.project.root, ep.file);
      if (!file || !this.project.sources.has(file)) continue;
      const moduleEnv = this.module(file); const entry = this.exports.get(file)?.get(ep.export)?.ref?.fn;
      if (!entry) throw new Error(`Resolver entry export not found: ${ep.file}#${ep.export}`);
      const env = new Map(moduleEnv);
      const frame: Frame = { env, depth: 0, context: ep.id, entry: true, file, moduleHops: 0 };
      for (const [i, p] of (entry.params ?? []).entries()) {
        let value = p.providerType ? this.root(p, 'high', 'provider_type', frame) : empty();
        if (!p.providerType && p.a?.k === 'id' && this.spec.changes.some(c => c.object === p.a?.text)) {
          value = this.root(p, 'low', 'name_heuristic', frame); this.diagnostic(p, 'heuristic_only:unproven_parameter');
        }
        if (i === 1 && ep.kind === 'express_route') value = { facts: [], ref: { kind: 'response', name: 'response', tail: [], confidence: 'high' } };
        this.bind(p.a ?? p, value, frame);
      }
      if (entry.a?.k === 'block') this.run(entry.a.items ?? [], frame);
      else if (entry.a) this.sink(entry.a, this.evaluate(entry.a, frame), 'returned_state', 'return', frame);
      if (![...this.nodes.values()].some(n => n.entryPointId === ep.id && n.kind === 'taint_root' && n.provenance.confidence !== 'low')) this.diagnostic(entry, 'no_taint_root');
    }
    const unique = <T>(values: T[]): T[] => [...new Map(values.map(v => [JSON.stringify(v), v])).values()].sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
    this.graph.nodes = [...this.nodes.values()].sort((a,b) => a.id.localeCompare(b.id, 'en'));
    this.graph.edges = unique(this.graph.edges); this.graph.sinks = unique(this.graph.sinks); this.graph.skipped = unique(this.graph.skipped);
    this.graph.affectedSites = [...new Map(this.graph.affectedSites.map(s => [s.id, s])).values()].sort((a,b) => a.id.localeCompare(b.id, 'en'));
    const adjacency = new Map<string, string[]>(); for (const e of this.graph.edges) adjacency.set(e.from, [...(adjacency.get(e.from) ?? []), e.to]);
    const sinks = new Set(this.graph.sinks.map(s => s.nodeId));
    for (const site of this.graph.affectedSites) {
      const seen = new Set<string>(); const queue = [site.nodeId];
      while (queue.length) { const id = queue.shift()!; if (seen.has(id)) continue; seen.add(id); queue.push(...(adjacency.get(id) ?? [])); }
      site.sinkNodeIds = [...seen].filter(id => sinks.has(id)).sort();
    }
    return this.graph;
  }
}
