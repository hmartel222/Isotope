import type { JsonValue, RecordedCall, SinkKind } from '@isotope/core';
import { HarnessExecutionError } from './errors';

/** Property access is inert. Only invocation records, using one execution-wide sequence. */
export function createRecorder(name: string, sinkKind: SinkKind, calls: RecordedCall[],
  returns: Record<string, JsonValue>, snapshot: (value: unknown) => JsonValue): unknown {
  return new Proxy(function () {}, {
    get(_target, key) {
      if (key === 'then' || typeof key === 'symbol') return undefined;
      return createRecorder(`${name}.${key}`, sinkKind, calls, returns, snapshot);
    },
    apply(_target, _thisArg, args: unknown[]) {
      if (calls.length >= 5000) throw new HarnessExecutionError('serialization_limit', 'Call count exceeded 5000');
      calls.push({ seq: calls.length, mock: name, sinkKind, args: snapshot(args) as JsonValue[] });
      return Object.hasOwn(returns, name) ? structuredClone(returns[name]) : undefined;
    },
  });
}
