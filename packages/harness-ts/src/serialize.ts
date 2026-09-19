import type { JsonValue } from '@isotope/core';

/** Phase 2 behavior serializer. Unsupported values fail closed, never disappear. */
export function serializeBehavior(value: unknown): JsonValue {
  const ancestors = new Set<object>();
  function visit(v: unknown, depth: number): JsonValue {
    if (depth > 20) throw new Error('Behavior serialization exceeded depth 20');
    if (v === undefined) return '__undefined__';
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number') {
      if (Number.isNaN(v)) return '__NaN__';
      if (!Number.isFinite(v)) return v > 0 ? '__Infinity__' : '__-Infinity__';
      return v;
    }
    if (v instanceof Date) return v.toISOString();
    if (typeof v !== 'object') throw new Error(`Unsupported Phase 2 behavior value: ${typeof v}`);
    if (ancestors.has(v)) throw new Error('Circular behavior value is unsupported in Phase 2');
    if (Object.getOwnPropertySymbols(v).length) throw new Error('Symbol properties are unsupported in Phase 2');
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw new Error('Unsupported Phase 2 behavior object');
    if ((Array.isArray(v) ? v.length : Object.keys(v).length) > 500) throw new Error('Behavior serialization exceeded breadth 500');
    ancestors.add(v);
    const result: JsonValue = Array.isArray(v)
      ? Array.from({ length: v.length }, (_, index) => visit(v[index], depth + 1))
      : Object.fromEntries(Object.keys(v).sort().map(key => [key, visit((v as Record<string, unknown>)[key], depth + 1)]));
    ancestors.delete(v);
    return result;
  }
  return visit(value, 0);
}
