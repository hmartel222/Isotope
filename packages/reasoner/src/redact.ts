import { Node, Project, SyntaxKind } from 'ts-morph';

export function redactSource(source: string, keepLiterals: Set<string>): { text: string; destroyedDecisionEvidence: boolean } {
  const project = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true });
  const file = project.createSourceFile('slice.ts', source, { overwrite: true });
  let destroyedDecisionEvidence = false;
  for (const literal of [...file.getDescendantsOfKind(SyntaxKind.StringLiteral)].reverse()) {
    const value = literal.getLiteralValue();
    if (!value || keepLiterals.has(value)) continue;
    const parent = literal.getParent();
    const decision = parent && (Node.isBinaryExpression(parent) || Node.isIfStatement(parent) || Node.isSwitchStatement(parent) || Node.isCaseClause(parent)
      || Node.isConditionalExpression(parent));
    if (decision) continue;
    literal.replaceWithText('"<redacted>"');
  }
  return { text: file.getFullText(), destroyedDecisionEvidence };
}
