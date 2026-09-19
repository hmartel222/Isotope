import { ts } from 'ts-morph';
import type { ChangeSpec } from '@isotope/core';

/** Path grammar only: names, quoted keys, numeric indices and wildcard array segments. */
export function parsePath(input: string): string[] {
  const result: string[] = []; let rest = input;
  while (rest) {
    if ((!result.length && rest.startsWith('.')) || (result.length && /^[A-Za-z_$]/.test(rest))) throw new Error(`Unsupported ChangeSpec path: ${input}`);
    const match = /^(?:\.?([A-Za-z_$][\w$]*)|\[(\*|\d+)\]|\["([^"\\]+)"\]|\['([^'\\]+)'\])/.exec(rest);
    if (!match) throw new Error(`Unsupported ChangeSpec path: ${input}`);
    result.push(match[1] ?? (match[2] ? '*' : match[3] ?? match[4]!)); rest = rest.slice(match[0].length);
  }
  if (!result.length) throw new Error('Empty ChangeSpec path');
  return result;
}
/** Optional provider envelope prefix (for example webhook `data.object`) is stripped before ChangeSpec path comparison. */
export const normalized = (path: string[], prefix: string[] = []): string[] =>
  prefix.length && prefix.every((part, index) => path[index] === part) && path.length >= prefix.length ? path.slice(prefix.length) : path;
export const pathText = (path: string[]): string => path.reduce((s, p) => p === '*' ? `${s}[*]` : p === '?' ? `${s}[?]` : /^[A-Za-z_$][\w$]*$/.test(p) ? `${s}${s ? '.' : ''}${p}` : `${s}[${JSON.stringify(p)}]`, '');
export const samePath = (a: string[], b: string[]): boolean => a.length === b.length && a.every((s, i) => s === b[i]);
export function callPatterns(spec: ChangeSpec): string[][] {
  const result: string[][] = [];
  for (const root of spec.detection.taint_roots.filter(r => r.language === 'ts')) {
    if (root.kind === 'type') {
      if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(root.pattern)) throw new Error(`Unsupported taint-root type pattern: ${root.pattern}`);
      continue; // Actual checker declaration provenance, rather than the spelling, proves type roots.
    }
    const source = ts.createSourceFile('pattern.ts', root.pattern, ts.ScriptTarget.Latest, true);
    if ((source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length) throw new Error(`Unsupported taint-root call pattern: ${root.pattern}`);
    const statement = source.statements[0];
    if (source.statements.length !== 1 || !statement || !ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) throw new Error(`Unsupported taint-root call pattern: ${root.pattern}`);
    const call = statement.expression; const members: string[] = []; let expression: ts.Expression = call.expression;
    while (ts.isPropertyAccessExpression(expression)) { members.unshift(expression.name.text); expression = expression.expression; }
    if (!ts.isIdentifier(expression) || !expression.text.startsWith('$') || !members.length || call.arguments.length !== 1 || !ts.isIdentifier(call.arguments[0]!) || (call.arguments[0] as ts.Identifier).text !== '$$$') throw new Error(`Unsupported taint-root call pattern: ${root.pattern}`);
    result.push(members);
  }
  return result;
}
