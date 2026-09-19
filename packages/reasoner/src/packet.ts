import { createHash } from 'node:crypto';
import { relative, resolve } from 'node:path';
import { Node, Project, type SourceFile } from 'ts-morph';
import {
  deterministicJson, validateContract,
  type BDG, type ChangeSpec, type DiffReport, type EntryPoint, type EvidencePacket, type JsonValue, type Signature,
} from '@isotope/core';
import { semanticDivergences } from './eligibility';
import { redactSource } from './redact';
import { estimateTokens, HARD_CAP_TOKENS, TARGET_TOKENS } from './tokens';

export interface PacketBuildInput {
  repoRoot: string; spec: ChangeSpec; bdg: BDG; entryPoint: EntryPoint; diff: DiffReport;
  old: Signature; new: Signature; oldPayload: unknown; newPayload: unknown; redact: boolean;
}
export type PacketBuildResult =
  | { ok: true; packet: EvidencePacket; hash: string; primaryDivergenceId: string; estimatedTokens: number }
  | { ok: false; reason: 'slice_overflow' | 'packet_budget_exceeded' | 'redaction_destroyed_evidence' };

function asJson(value: unknown): JsonValue {
  return (value ?? null) as JsonValue;
}

function payloadRoot(payload: JsonValue): JsonValue {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const data = (payload as Record<string, JsonValue>).data;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const object = (data as Record<string, JsonValue>).object;
      if (object && typeof object === 'object') return object;
    }
  }
  return payload;
}
function readPath(root: JsonValue, path: string): JsonValue | undefined {
  let value: unknown = root;
  for (const part of path.replace(/\[\*\]/g, '').split('.').filter(Boolean)) {
    if (!value || typeof value !== 'object') return undefined;
    value = Array.isArray(value) ? value.map(item => (item && typeof item === 'object' ? (item as Record<string, unknown>)[part] : undefined))
      : (value as Record<string, unknown>)[part];
  }
  return value as JsonValue | undefined;
}
function fragment(payload: JsonValue, removed: string, replacement: string): JsonValue {
  const root = payloadRoot(payload);
  const out: Record<string, JsonValue> = {};
  const removedValue = readPath(root, removed); if (removedValue !== undefined) out[removed] = removedValue;
  const replacementValue = readPath(root, replacement); if (replacementValue !== undefined) out[replacement] = replacementValue;
  const items = readPath(root, 'items.data');
  if (Array.isArray(items)) out['items.data.length'] = items.length;
  return out;
}
function ambiguitySatisfied(payload: JsonValue, expression: string): boolean {
  const match = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.length\s*>\s*(\d+)$/.exec(expression.trim());
  if (!match) return false;
  const value = readPath(payloadRoot(payload), match[1]!);
  return Array.isArray(value) && value.length > Number(match[2]);
}

function narrowSignature(signature: Signature, diff: DiffReport): Signature {
  const indexes = new Set<number>();
  for (const divergence of semanticDivergences(diff)) {
    const call = /^\/calls\/(\d+)/.exec(divergence.pointer);
    if (call) {
      const index = Number(call[1]);
      for (let offset = -2; offset <= 2; offset++) if (index + offset >= 0) indexes.add(index + offset);
    }
  }
  const calls = signature.calls.filter((_, index) => indexes.has(index)).map((call, seq) => ({ ...call, seq }));
  return { ...signature, calls, durationMs: 0 };
}

function dataflowSummary(bdg: BDG, entryPointId: string): string {
  const nodes = bdg.nodes.filter(node => node.entryPointId === entryPointId);
  const path = nodes.filter(node => ['taint_root', 'binding', 'transform', 'sink'].includes(node.kind))
    .sort((a, b) => a.location.line - b.location.line)
    .map(node => node.path || node.label);
  return path.length ? path.join(' → ') : 'provider → sink';
}

function functionAt(source: SourceFile, line: number): { name: string; start: number; end: number; text: string } | undefined {
  try {
    const position = source.compilerNode.getPositionOfLineAndCharacter(Math.max(0, line - 1), 0);
    let node: Node | undefined = source.getDescendantAtPos(position);
    while (node) {
      if (Node.isFunctionDeclaration(node) || Node.isFunctionExpression(node) || Node.isArrowFunction(node) || Node.isMethodDeclaration(node)) {
        const name = Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node) ? node.getName() ?? 'anonymous' : 'anonymous';
        return { name, start: node.getStartLineNumber(), end: node.getEndLineNumber(), text: node.getText() };
      }
      node = node.getParent();
    }
  } catch { return undefined; }
  return undefined;
}

async function loadFile(project: Project, repoRoot: string, file: string): Promise<SourceFile> {
  const absolute = resolve(repoRoot, file);
  return project.getSourceFile(absolute) ?? project.addSourceFileAtPath(absolute);
}

async function primarySlice(input: PacketBuildInput): Promise<{ file: string; exportName: string; lines: [number, number]; slice: string } | { reason: 'slice_overflow' }> {
  const project = new Project({ skipAddingFilesFromTsConfig: true, compilerOptions: { allowJs: true } });
  const source = await loadFile(project, input.repoRoot, input.entryPoint.file);
  const sites = input.bdg.affectedSites.filter(site => site.entryPointId === input.entryPoint.id);
  const sinkLines = input.bdg.sinks.filter(sink => input.bdg.nodes.some(node => node.id === sink.nodeId && node.entryPointId === input.entryPoint.id)).map(sink => sink.location.line);
  const lines = [...sites.map(site => site.location.line), ...sinkLines, 1];
  const min = Math.min(...lines); const max = Math.max(...lines);
  const enclosing = functionAt(source, min) ?? functionAt(source, max);
  if (enclosing && enclosing.end - enclosing.start + 1 <= 200 && enclosing.start <= min && enclosing.end >= max) {
    return { file: input.entryPoint.file, exportName: input.entryPoint.export, lines: [enclosing.start, enclosing.end], slice: enclosing.text };
  }
  const start = Math.max(1, min - 8); const end = Math.min(source.getEndLineNumber(), max + 8);
  if (end - start + 1 > 200) return { reason: 'slice_overflow' };
  const text = source.getFullText().split(/\r?\n/).slice(start - 1, end).join('\n');
  return { file: input.entryPoint.file, exportName: input.entryPoint.export, lines: [start, end], slice: text };
}

async function downstreamSlices(input: PacketBuildInput, primary: { start: number; end: number; file: string }): Promise<{ file: string; name: string; slice: string }[]> {
  const project = new Project({ skipAddingFilesFromTsConfig: true, compilerOptions: { allowJs: true } });
  const sinkIds = new Set(input.bdg.affectedSites.filter(site => site.entryPointId === input.entryPoint.id).flatMap(site => site.sinkNodeIds));
  const locals = input.bdg.nodes.filter(node => node.entryPointId === input.entryPoint.id && node.kind === 'local_call'
    && (node.location.file !== primary.file || node.location.line < primary.start || node.location.line > primary.end));
  const ranked = [...locals].sort((a, b) => {
    const aHit = a.path && sinkIds.size ? 0 : 1; const bHit = b.path && sinkIds.size ? 0 : 1;
    return aHit - bHit || a.location.line - b.location.line;
  });
  const used = new Set<string>(); const out: { file: string; name: string; slice: string }[] = [];
  for (const node of ranked) {
    if (out.length >= 3) break;
    const source = await loadFile(project, input.repoRoot, node.location.file);
    const fn = functionAt(source, node.location.line);
    if (!fn || fn.end - fn.start + 1 > 80) continue;
    const key = `${node.location.file}:${fn.name}:${fn.start}`;
    if (used.has(key)) continue; used.add(key);
    out.push({ file: relative(input.repoRoot, resolve(input.repoRoot, node.location.file)).split('\\').join('/'), name: fn.name, slice: fn.text });
  }
  return out;
}

function keepLiterals(oldPayload: JsonValue, newPayload: JsonValue, diff: DiffReport): Set<string> {
  const values = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === 'string') values.add(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(oldPayload); visit(newPayload);
  for (const divergence of diff.divergences) { visit(divergence.old); visit(divergence.new); }
  return values;
}

export async function buildEvidencePacket(input: PacketBuildInput): Promise<PacketBuildResult> {
  const semantic = semanticDivergences(input.diff);
  const site = input.bdg.affectedSites.find(item => item.entryPointId === input.entryPoint.id);
  const change = input.spec.changes[site?.changeIndex ?? 0] ?? input.spec.changes[0]!;
  const slice = await primarySlice(input);
  if ('reason' in slice) return { ok: false, reason: 'slice_overflow' };
  let downstream = await downstreamSlices(input, { start: slice.lines[0], end: slice.lines[1], file: slice.file });
  const nodes = input.bdg.nodes.filter(node => node.entryPointId === input.entryPoint.id);
  const sinks = input.bdg.sinks.filter(sink => nodes.some(node => node.id === sink.nodeId));
  const hint = change.ambiguity && ambiguitySatisfied(asJson(input.newPayload), change.ambiguity.when)
    ? { when: change.ambiguity.when, satisfied: true, question: change.ambiguity.question } : undefined;
  const oldPayload = asJson(input.oldPayload); const newPayload = asJson(input.newPayload);
  const keep = keepLiterals(oldPayload, newPayload, input.diff);
  let primary = slice.slice; let destroyed = false;
  if (input.redact) {
    const redacted = redactSource(primary, keep); primary = redacted.text; destroyed = redacted.destroyedDecisionEvidence;
    downstream = downstream.map(fn => { const next = redactSource(fn.slice, keep); destroyed = destroyed || next.destroyedDecisionEvidence; return { ...fn, slice: next.text }; });
  }
  if (destroyed) return { ok: false, reason: 'redaction_destroyed_evidence' };
  let oldSig = narrowSignature(input.old, input.diff); let newSig = narrowSignature(input.new, input.diff);
  let graphNodes = nodes; let graphSinks = sinks;
  const assemble = () => validateContract('EvidencePacket', {
    packetVersion: 1,
    change: { specId: input.spec.id, title: input.spec.title, semantics: input.spec.semantics, removedPath: change.removed_path, replacement: change.replacement, ...(hint ? { ambiguityHint: hint } : {}) },
    code: { language: input.entryPoint.language, entryPoint: { file: slice.file, export: slice.exportName, lines: slice.lines }, slice: primary, downstreamFunctions: downstream },
    dataflow: { summary: dataflowSummary(input.bdg, input.entryPoint.id), nodes: graphNodes, sinks: graphSinks },
    execution: { old: oldSig, new: newSig },
    diff: semantic,
    payloadFragments: { old: fragment(oldPayload, change.removed_path, change.replacement.path), new: fragment(newPayload, change.removed_path, change.replacement.path) },
  });
  let packet = assemble();
  const shrink = () => {
    if (downstream.length) { downstream = downstream.slice(0, -1); return true; }
    if (oldSig.calls.length > 1 || newSig.calls.length > 1) {
      oldSig = { ...oldSig, calls: oldSig.calls.slice(0, Math.max(1, oldSig.calls.length - 1)) };
      newSig = { ...newSig, calls: newSig.calls.slice(0, Math.max(1, newSig.calls.length - 1)) };
      return true;
    }
    if (graphNodes.length > 2) { graphNodes = graphNodes.filter(node => node.kind === 'taint_root' || node.kind === 'sink'); return true; }
    return false;
  };
  while (estimateTokens(deterministicJson(packet)) > TARGET_TOKENS && shrink()) packet = assemble();
  const tokens = estimateTokens(deterministicJson(packet));
  if (tokens > HARD_CAP_TOKENS) return { ok: false, reason: 'packet_budget_exceeded' };
  const hash = createHash('sha256').update(deterministicJson(packet)).digest('hex');
  return { ok: true, packet, hash, primaryDivergenceId: semantic[0]!.id, estimatedTokens: tokens };
}

export function packetHash(packet: EvidencePacket): string {
  return createHash('sha256').update(deterministicJson(packet)).digest('hex');
}
