import { Node, Project, SyntaxKind } from 'ts-morph';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function redactSource(source: string, keepLiterals: Set<string>, preserve: string[] = []): { text: string; destroyedDecisionEvidence: boolean } {
  const extra = preserve.filter(Boolean).map(escapeRegExp).join('|');
  const preserved = extra ? new RegExp(extra, 'i') : /$^/;
  const project = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true });
  const file = project.createSourceFile('slice.ts', source, { overwrite: true });
  let destroyedDecisionEvidence = false;
  for (const literal of [...file.getDescendantsOfKind(SyntaxKind.StringLiteral)].reverse()) {
    const value = literal.getLiteralValue();
    if (!value || preserved.test(value) || keepLiterals.has(value)) continue;
    const parent = literal.getParent();
    const decision = parent && (Node.isBinaryExpression(parent) || Node.isIfStatement(parent) || Node.isSwitchStatement(parent) || Node.isCaseClause(parent)
      || Node.isConditionalExpression(parent));
    if (decision) continue;
    literal.replaceWithText('"<redacted>"');
  }
  return { text: file.getFullText(), destroyedDecisionEvidence };
}
