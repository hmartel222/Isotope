import { ArtifactValidationError, deterministicJson, validateContract, type JsonValue, type RecordedCall, type Signature } from '@isotope/core';

/** Missing property is distinct from a present serialized undefined value. */
export const ABSENT = Symbol('absent');
export type Value = JsonValue | typeof ABSENT;
export const UNDEFINED = '__undefined__';
export const storedValue = (value: Value): JsonValue => value === ABSENT ? UNDEFINED : value;
export const isMissing = (value: Value): boolean => value === ABSENT || value === null || value === UNDEFINED;
export const pointerKey = (key: string): string => key.replace(/~/g, '~0').replace(/\//g, '~1');
export function normalizedType(value: Value): string {
  if (value === ABSENT) return 'absent';
  if (value === null) return 'null';
  if (value === UNDEFINED) return 'undefined';
  if (Array.isArray(value)) return 'array';
  // Other sentinels remain their serialized JSON types; L4 does not rehydrate values.
  return typeof value;
}
export function isRecord(value: Value): value is Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function sameCall(a: RecordedCall, b: RecordedCall): boolean { return a.mock === b.mock && a.sinkKind === b.sinkKind; }

/** Metadata is retained in artifacts, never treated as behavioral evidence. */
export function behavioralView(signature: Signature): Pick<Signature, 'returned' | 'threw' | 'calls'> {
  return { returned: signature.returned, threw: signature.threw, calls: signature.calls };
}
export function behaviorEqual(a: Signature, b: Signature): boolean {
  return deterministicJson(behavioralView(a)) === deterministicJson(behavioralView(b));
}
export function validateSignature(signature: Signature): void {
  validateContract('Signature', signature);
  if (signature.calls.some((call, index) => call.seq !== index)) throw new ArtifactValidationError('Signature', ['calls must retain contiguous ordered seq values starting at zero']);
}
export type Position = 'value' | 'object-key' | 'array-slot';
export type ChangeVisitor = (old: Value, next: Value, pointer: string, position: Position) => void;

/** Sorted object keys, numeric array indices. Each differing leaf is visited once. */
export function visitChanges(old: Value, next: Value, pointer: string, emit: ChangeVisitor, position: Position = 'value'): void {
  if (old === next) return;
  if (isRecord(old) && isRecord(next)) {
    for (const key of [...new Set([...Object.keys(old), ...Object.keys(next)])].sort()) {
      visitChanges(Object.hasOwn(old, key) ? old[key]! : ABSENT, Object.hasOwn(next, key) ? next[key]! : ABSENT,
        `${pointer}/${pointerKey(key)}`, emit, 'object-key');
    }
  } else if (Array.isArray(old) && Array.isArray(next)) {
    for (let index = 0; index < Math.max(old.length, next.length); index++) {
      visitChanges(index < old.length ? old[index]! : ABSENT, index < next.length ? next[index]! : ABSENT,
        `${pointer}/${index}`, emit, 'array-slot');
    }
  } else emit(old, next, pointer, position);
}
export function checkDeterminism(runs: [Signature, Signature]): { stable: boolean; unstablePointers: string[] } {
  runs.forEach(validateSignature);
  const unstablePointers: string[] = [];
  visitChanges(behavioralView(runs[0]) as JsonValue, behavioralView(runs[1]) as JsonValue, '', (_a, _b, pointer) => unstablePointers.push(pointer));
  return { stable: unstablePointers.length === 0, unstablePointers };
}
