export function readMetaVersion(meta: Record<string, unknown> | undefined, side: 'old' | 'new'): string | undefined {
  const key = side === 'new' ? 'newVersion' : 'oldVersion';
  const labeled = meta?.[key];
  if (typeof labeled === 'string' && labeled) return labeled;
  return undefined;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function followPrefix(payload: unknown, prefix: readonly string[]): unknown {
  let current: unknown = payload;
  for (const part of prefix) {
    const record = asRecord(current);
    if (!record) return undefined;
    current = record[part];
  }
  return current;
}
