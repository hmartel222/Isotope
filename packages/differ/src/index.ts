import { ArtifactValidationError, signatureArtifactRef, validateContract, type BDG, type DiffInput, type DiffReport, type Divergence, type JsonValue, type SinkKind } from '@isotope/core';
import { ABSENT, behavioralView, behaviorEqual, checkDeterminism, isMissing, normalizedType, sameCall, storedValue, validateSignature, visitChanges, type Value } from './behavior';
export { behavioralView, behaviorEqual, checkDeterminism, isMissing, normalizedType, sameCall } from './behavior';

/** Evidence enrichment only: require exactly one matching sink in this entry point. */
function sinkNode(bdg: BDG | undefined, entryPointId: string, kind: SinkKind, name?: string): string | null {
  if (!bdg) return null;
  const matches = bdg.sinks.filter(sink => sink.kind === kind && (name === undefined || sink.name === name)
    && bdg.nodes.some(node => node.id === sink.nodeId && node.entryPointId === entryPointId && node.kind === 'sink'));
  return matches.length === 1 ? matches[0]!.nodeId : null;
}
function decision(kind: Divergence['kind'], sink: SinkKind | null): Pick<Divergence, 'tier' | 'severity'> {
  switch (kind) {
    case 'value_to_missing': case 'call_dropped': return { tier: 'mechanical', severity: 'critical' };
    case 'threw_new_only': return { tier: 'mechanical', severity: 'high' };
    case 'field_added': return { tier: 'mechanical', severity: 'info' };
    case 'unstable': return { tier: 'mechanical', severity: null };
    default: return sink === 'log_only' ? { tier: 'mechanical', severity: 'info' } : { tier: 'semantic_question', severity: null };
  }
}

/** Pure L4: all execution, graph and ambiguity facts arrive as arguments. No I/O. */
export function diffSignatures(input: DiffInput): DiffReport {
  const { old, new: next, bdg, changeContext } = input;
  validateSignature(old); validateSignature(next);
  const selfOld = checkDeterminism(input.selfComparisons.old);
  const selfNew = checkDeterminism(input.selfComparisons.new);
  if (!behaviorEqual(old, input.selfComparisons.old[0]) || !behaviorEqual(next, input.selfComparisons.new[0])) {
    throw new ArtifactValidationError('DiffInput', ['compared signatures must match the behavior of their first self-comparison runs']);
  }
  if (changeContext?.affectedPointers.some(pointer => !/^(?:\/(?:[^~/]|~[01])*)*$/.test(pointer))) {
    throw new ArtifactValidationError('DiffInput', ['ambiguity affectedPointers must be valid JSON Pointers']);
  }
  const unstablePointers = [...new Set([...selfOld.unstablePointers, ...selfNew.unstablePointers])].sort();
  const divergences: Divergence[] = [];
  function add(kind: Divergence['kind'], a: Value, b: Value, pointer: string, sinkKind: SinkKind | null, bdgNodeId: string | null): void {
    const metadata = decision(kind, sinkKind);
    const ambiguity = metadata.tier === 'semantic_question' && changeContext?.ambiguitySatisfied
      && changeContext.affectedPointers.some(affected => pointer === affected || pointer.startsWith(`${affected}/`));
    divergences.push({ id: `d${divergences.length}`, kind, pointer, sinkKind, old: storedValue(a), new: storedValue(b),
      ...metadata, bdgNodeId, ...(ambiguity ? { ambiguityCandidate: true } : {}) });
  }
  function compare(a: Value, b: Value, pointer: string, sinkKind: SinkKind, nodeId: string | null, args = false): void {
    visitChanges(a, b, pointer, (previous, current, location, position) => {
      // Equal was handled by traversal. Specific loss precedes additions, types and residuals.
      const kind = !isMissing(previous) && isMissing(current) ? 'value_to_missing'
        : previous === ABSENT && position === 'object-key' ? 'field_added'
        : position === 'array-slot' && (previous === ABSENT || current === ABSENT) ? (args ? 'call_args_changed' : 'value_changed')
        : normalizedType(previous) !== normalizedType(current) ? 'type_changed' : 'value_changed';
      add(kind, previous, current, location, sinkKind, nodeId);
    });
  }
  if (unstablePointers.length) {
    // Only self-comparison evidence is emitted. Never classify the unreliable old/new pair.
    for (const pair of [input.selfComparisons.old, input.selfComparisons.new]) {
      visitChanges(behavioralView(pair[0]) as JsonValue, behavioralView(pair[1]) as JsonValue, '',
        (a, b, pointer) => add('unstable', a, b, pointer, null, null));
    }
  } else {
    compare(old.returned, next.returned, '/returned', 'returned_state', sinkNode(bdg, old.entryPointId, 'returned_state'));
    if (old.threw === null && next.threw !== null) add('threw_new_only', null, next.threw, '/threw', null, null);
    else if (old.threw !== null && next.threw === null) add('value_changed', old.threw, null, '/threw', null, null);
    else {
      // Changed errors (including removed optional stack) are semantic, never generic data loss.
      visitChanges(old.threw, next.threw, '/threw', (a, b, pointer) =>
        add(normalizedType(a) === normalizedType(b) ? 'value_changed' : 'type_changed', a, b, pointer, null, null));
    }
    for (let index = 0; index < Math.max(old.calls.length, next.calls.length); index++) {
      const a = old.calls[index]; const b = next.calls[index];
      const pointer = `/calls/${index}`;
      if (a && b && sameCall(a, b)) {
        compare(a.args, b.args, `${pointer}/args`, a.sinkKind, sinkNode(bdg, old.entryPointId, a.sinkKind, a.mock), true);
      } else {
        // Identity replacement is a drop then an addition. Never realign by name or arguments.
        if (a) add('call_dropped', a, ABSENT, pointer, a.sinkKind, sinkNode(bdg, old.entryPointId, a.sinkKind, a.mock));
        if (b) add('call_added', ABSENT, b, pointer, b.sinkKind, sinkNode(bdg, next.entryPointId, b.sinkKind, b.mock));
      }
    }
  }
  // IDs follow traversal: returned, threw, calls by numeric seq, sorted keys/numeric indices.
  return validateContract('DiffReport', { schemaVersion: 1, entryPointId: old.entryPointId, fixturePair: old.fixturePair,
    oldSignatureRef: signatureArtifactRef(old), newSignatureRef: signatureArtifactRef(next), stable: unstablePointers.length === 0, unstablePointers, divergences });
}
