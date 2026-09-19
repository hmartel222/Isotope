import { relative } from 'node:path';
import { artifactPaths, deterministicJson, validateContract, type BDG, type DiffInput, type DiffReport, type Divergence, type JsonValue, type Signature, type SinkKind } from '@isotope/core';

/** The single definition of comparable behavior. Metadata stays in stored artifacts. */
export function behavioralView(signature: Signature): Pick<Signature, 'returned' | 'threw' | 'calls'> {
  return { returned: signature.returned, threw: signature.threw, calls: signature.calls };
}
export function behaviorEqual(a: Signature, b: Signature): boolean {
  return deterministicJson(behavioralView(a)) === deterministicJson(behavioralView(b));
}
const missing = Symbol('absent');
type Value = JsonValue | typeof missing;
const absent = (v: Value) => v === missing || v === '__undefined__' || v === null;
const stored = (v: Value): JsonValue => v === missing ? '__undefined__' : v;
const pointerKey = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');
const record = (v: Value): v is Record<string, JsonValue> => typeof v === 'object' && v !== null && !Array.isArray(v);
const equivalent = (a: Value, b: Value) => a === missing || b === missing ? a === b : deterministicJson(a) === deterministicJson(b);

function changes(old: Value, current: Value, pointer: string, emit: (old: Value, current: Value, pointer: string) => void): void {
  if (equivalent(old, current)) return;
  if (record(old) && record(current)) {
    for (const key of [...new Set([...Object.keys(old), ...Object.keys(current)])].sort()) {
      changes(Object.hasOwn(old, key) ? old[key]! : missing, Object.hasOwn(current, key) ? current[key]! : missing, `${pointer}/${pointerKey(key)}`, emit);
    }
  } else if (Array.isArray(old) && Array.isArray(current)) {
    for (let index = 0; index < Math.max(old.length, current.length); index++) changes(index < old.length ? old[index]! : missing, index < current.length ? current[index]! : missing, `${pointer}/${index}`, emit);
  } else emit(old, current, pointer);
}

export function checkDeterminism(runs: [Signature, Signature]): { stable: boolean; unstablePointers: string[] } {
  const unstablePointers: string[] = [];
  changes(behavioralView(runs[0]) as JsonValue, behavioralView(runs[1]) as JsonValue, '', (_a, _b, pointer) => unstablePointers.push(pointer));
  return { stable: unstablePointers.length === 0, unstablePointers };
}
function signatureRef(signature: Signature): string {
  const paths = artifactPaths('/');
  return relative(paths.root, paths.signature(signature));
}

/** Phase 2 structural subset. Semantic residuals are recorded, never guessed to be failures. */
export function diffSignatures(input: DiffInput): DiffReport {
  const { old, new: current, bdg } = input;
  for (const sig of [old, current, ...input.selfComparisons.old, ...input.selfComparisons.new]) {
    validateContract('Signature', sig);
    if (sig.calls.some((call, index) => call.seq !== index)) throw new Error('Signature calls must retain contiguous ordered seq values starting at zero');
  }
  const selfOld = checkDeterminism(input.selfComparisons.old);
  const selfNew = checkDeterminism(input.selfComparisons.new);
  const unstablePointers = [...new Set([...selfOld.unstablePointers, ...selfNew.unstablePointers])];
  const divergences: Divergence[] = [];
  function add(kind: Divergence['kind'], a: Value, b: Value, pointer: string, sinkKind: SinkKind | null, nodeId: string | null): void {
    const mechanical = ['unstable', 'value_to_missing', 'call_dropped', 'threw_new_only', 'field_added'].includes(kind) || sinkKind === 'log_only';
    const severity = sinkKind === 'log_only' || kind === 'field_added' ? 'info' : ['value_to_missing', 'call_dropped'].includes(kind) ? 'critical' : kind === 'threw_new_only' ? 'high' : null;
    divergences.push({ id: `d${divergences.length}`, kind, pointer, sinkKind, old: stored(a), new: stored(b), tier: mechanical ? 'mechanical' : 'semantic_question', severity, bdgNodeId: nodeId });
  }
  function compare(a: Value, b: Value, pointer: string, sinkKind: SinkKind | null, nodeId: string | null) {
    changes(a, b, pointer, (previous, next, location) => {
      const kind = !absent(previous) && absent(next) ? 'value_to_missing' : previous === missing ? 'value_changed' : typeof previous !== typeof next || Array.isArray(previous) !== Array.isArray(next) ? 'type_changed' : 'value_changed';
      add(kind, previous, next, location, sinkKind, nodeId);
    });
  }
  if (unstablePointers.length) {
    // Determinism gates comparison. No old/new incompatibility is inferred over noise.
    for (const pair of [input.selfComparisons.old, input.selfComparisons.new]) changes(behavioralView(pair[0]) as JsonValue, behavioralView(pair[1]) as JsonValue, '', (a, b, p) => add('unstable', a, b, p, null, null));
  } else {
    const returnedSink = bdg.sinks.find(s => s.kind === 'returned_state');
    compare(old.returned, current.returned, '/returned', 'returned_state', returnedSink?.nodeId ?? null);
    if (old.threw === null && current.threw !== null) add('threw_new_only', null, current.threw, '/threw', null, null);
    else if (!equivalent(old.threw, current.threw)) add('value_changed', old.threw, current.threw, '/threw', null, null);
    for (let index = 0; index < Math.max(old.calls.length, current.calls.length); index++) {
      const a = old.calls[index]; const b = current.calls[index];
      const node = (name: string) => bdg.sinks.find(s => s.name === name)?.nodeId ?? null;
      // No shifting to disguise a dropped call. More sophisticated alignment is later work.
      if (a && (!b || a.mock !== b.mock || a.sinkKind !== b.sinkKind)) add('call_dropped', a, missing, `/calls/${index}`, a.sinkKind, node(a.mock));
      if (b && (!a || a.mock !== b.mock || a.sinkKind !== b.sinkKind)) add('call_added', missing, b, `/calls/${index}`, b.sinkKind, node(b.mock));
      if (a && b && a.mock === b.mock && a.sinkKind === b.sinkKind) compare(a.args, b.args, `/calls/${index}/args`, a.sinkKind, node(a.mock));
    }
  }
  return validateContract('DiffReport', { schemaVersion: 1, entryPointId: old.entryPointId, fixturePair: old.fixturePair,
    oldSignatureRef: signatureRef(old), newSignatureRef: signatureRef(current), stable: unstablePointers.length === 0, unstablePointers, divergences });
}
