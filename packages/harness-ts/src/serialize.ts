import { createHash } from 'node:crypto';
import type { JsonValue } from '@isotope/core';

/** Limits are signaled to the runtime, which refuses to compare truncated evidence. */
export function serializeBehavior(value: unknown, onLimit: (limit: string) => void = () => {}): JsonValue {
  const ancestors = new Set<object>();
  let budget = 10_000;
  let textBudget = 1_048_576;
  const limit = (name: string) => { onLimit(name); return `__${name}_limit__`; };
  function visit(v: unknown, depth: number): JsonValue {
    if (--budget < 0) return limit('node');
    if (depth > 20) return limit('depth');
    if (v === undefined) return '__undefined__';
    if (typeof v === 'function') return '__fn__';
    if (typeof v === 'bigint') return `__bigint__:${v}`;
    if (typeof v === 'symbol') throw new Error('Symbol values are unsupported');
    if (typeof v === 'string') {
      const allowed = Math.max(0, Math.min(65536, textBudget));
      textBudget -= Math.min(v.length, allowed);
      return v.length > allowed ? v.slice(0, allowed) + limit('string') : v;
    }
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number') {
      if (Number.isNaN(v)) return '__NaN__';
      if (!Number.isFinite(v)) return v > 0 ? '__Infinity__' : '__-Infinity__';
      return v;
    }
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? '__invalid_date__' : v.toISOString();
    if (Buffer.isBuffer(v)) return { __buffer__: createHash('sha256').update(v).digest('hex') };
    if (typeof v !== 'object') throw new Error('Unsupported behavior value');
    if (ancestors.has(v)) return '__circular__';
    if (Object.getOwnPropertySymbols(v).length) throw new Error('Symbol properties are unsupported');
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw new Error('Unsupported behavior object');
    ancestors.add(v);
    let result: JsonValue;
    if (Array.isArray(v)) {
      const values: JsonValue[] = [];
      for (let i = 0; i < Math.min(v.length, 500); i++) {
        if (budget <= 0) { values.push(limit('node')); break; }
        values.push(visit(v[i], depth + 1));
      }
      if (v.length > 500) values.push(limit('breadth'));
      result = values;
    } else {
      const keys = Object.keys(v).sort();
      const entries: [string, JsonValue][] = [];
      for (const key of keys.slice(0, 500)) {
        if (budget <= 0) { entries.push(['__node_limit__', limit('node')]); break; }
        if (key.length > 65536 || key.length > textBudget) { entries.push(['__string_limit__', limit('string')]); break; }
        textBudget -= key.length;
        const descriptor = Object.getOwnPropertyDescriptor(v, key)!;
        if (!('value' in descriptor)) throw new Error('Accessor properties are unsupported');
        entries.push([key, visit(descriptor.value, depth + 1)]);
      }
      if (keys.length > 500) entries.push(['__breadth_limit__', limit('breadth')]);
      result = Object.fromEntries(entries);
    }
    ancestors.delete(v);
    return result;
  }
  return visit(value, 0);
}
