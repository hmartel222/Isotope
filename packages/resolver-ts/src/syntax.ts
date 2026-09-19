import { ts } from 'ts-morph';
import { parse } from '@babel/parser';

/** Small, frontend-neutral behavioral syntax. Unknown syntax is explicit, never text-matched. */
export interface Syntax {
  k: string; file: string; start: number; end: number; text?: string; op?: string;
  a?: Syntax; b?: Syntax; c?: Syntax; items?: Syntax[]; params?: Syntax[];
  exported?: string; providerType?: boolean; array?: boolean;
}
export interface Source { file: string; text: string; statements: Syntax[]; fallback: boolean }
export function fromTypeScript(file: ts.SourceFile, providerType: (node: ts.Node) => boolean): Source {
  const cv = (n: ts.Node): Syntax => {
    const base = { file: file.fileName, start: n.getStart(file), end: n.end };
    const make = (k: string, fields: Partial<Syntax> = {}): Syntax => ({ ...base, k, ...fields });
    const list = (nodes: readonly ts.Node[]) => nodes.map(cv);
    const exported = ts.canHaveModifiers(n) && ts.getModifiers(n)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
    const defaulted = ts.canHaveModifiers(n) && ts.getModifiers(n)?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword);
    if (ts.isIdentifier(n)) return make('id', { text: n.text });
    if (ts.isStringLiteralLike(n) || ts.isNumericLiteral(n)) return make('literal', { text: n.text, op: ts.isNumericLiteral(n) ? 'number' : 'string' });
    if (ts.isImportDeclaration(n)) {
      const items: Syntax[] = []; const clause = n.importClause;
      if (clause?.name) items.push({ ...cv(clause.name), op: 'default' });
      if (clause?.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) items.push({ ...cv(clause.namedBindings.name), op: '*' });
        else for (const s of clause.namedBindings.elements) items.push({ ...cv(s.name), op: s.propertyName?.text ?? s.name.text });
      }
      return make('import', { text: (n.moduleSpecifier as ts.StringLiteral).text, items });
    }
    if (ts.isExportDeclaration(n)) return make('export', { ...(n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) ? { text: n.moduleSpecifier.text } : {}), items: n.exportClause && ts.isNamedExports(n.exportClause) ? n.exportClause.elements.map(s => ({ ...cv(s.name), op: s.propertyName?.text ?? s.name.text })) : [] });
    if (ts.isExportAssignment(n)) return make('exportDefault', { a: cv(n.expression) });
    if (ts.isVariableStatement(n)) return make('block', { op: 'declarations', items: n.declarationList.declarations.map(d => ({ ...cv(d), ...(exported ? { exported: ts.isIdentifier(d.name) ? d.name.text : '' } : {}) })) });
    if (ts.isVariableDeclaration(n) || ts.isParameter(n)) return make('variable', { a: cv(n.name), ...(n.initializer ? { b: cv(n.initializer) } : {}), providerType: n.type !== undefined && providerType(n), array: false });
    if (ts.isObjectBindingPattern(n) || ts.isArrayBindingPattern(n)) return make(ts.isObjectBindingPattern(n) ? 'objectPattern' : 'arrayPattern', { items: list(n.elements) });
    if (ts.isBindingElement(n)) return make('property', { a: n.propertyName ? cv(n.propertyName) : cv(n.name), b: cv(n.name), ...(n.dotDotDotToken ? { op: 'rest' } : {}) });
    if (ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n)) return make('function', { text: n.name?.text ?? '', params: list(n.parameters), ...(n.body ? { a: cv(n.body) } : {}), ...(exported ? { exported: defaulted ? 'default' : n.name?.text ?? 'default' } : {}) });
    if (ts.isBlock(n) || ts.isSourceFile(n)) return make('block', { items: list(n.statements) });
    if (ts.isExpressionStatement(n)) return make('expression', { a: cv(n.expression) });
    if (ts.isReturnStatement(n) || ts.isThrowStatement(n)) return make(ts.isReturnStatement(n) ? 'return' : 'throw', { ...(n.expression ? { a: cv(n.expression) } : {}) });
    if (ts.isIfStatement(n)) return make('if', { a: cv(n.expression), b: cv(n.thenStatement), ...(n.elseStatement ? { c: cv(n.elseStatement) } : {}) });
    if (ts.isConditionalExpression(n)) return make('conditional', { a: cv(n.condition), b: cv(n.whenTrue), c: cv(n.whenFalse) });
    if (ts.isPropertyAccessExpression(n)) return make('member', { a: cv(n.expression), b: cv(n.name), op: 'exact', array: false });
    if (ts.isElementAccessExpression(n)) return make('member', { a: cv(n.expression), b: cv(n.argumentExpression), op: 'computed', array: false });
    if (ts.isCallExpression(n) || ts.isNewExpression(n)) return make(ts.isCallExpression(n) ? 'call' : 'new', { a: cv(n.expression), items: list(n.arguments ?? []) });
    if (ts.isAwaitExpression(n) || ts.isParenthesizedExpression(n) || ts.isNonNullExpression(n) || ts.isSpreadElement(n) || ts.isSpreadAssignment(n)) return make('unwrap', { a: cv(n.expression) });
    if (ts.isAsExpression(n) || ts.isTypeAssertionExpression(n)) return make('cast', { a: cv(n.expression) });
    if (ts.isObjectLiteralExpression(n)) return make('object', { items: list(n.properties) });
    if (ts.isPropertyAssignment(n)) return make('property', { a: cv(n.name), b: cv(n.initializer) });
    if (ts.isShorthandPropertyAssignment(n)) return make('property', { a: cv(n.name), b: cv(n.name) });
    if (ts.isArrayLiteralExpression(n)) return make('array', { items: list(n.elements) });
    if (ts.isBinaryExpression(n)) return make('binary', { a: cv(n.left), b: cv(n.right), op: ts.tokenToString(n.operatorToken.kind) ?? '?' });
    if (ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) return make('unary', { a: cv(n.operand), op: ts.tokenToString(n.operator) ?? '?' });
    if (ts.isTemplateExpression(n)) return make('template', { items: n.templateSpans.map(s => cv(s.expression)) });
    if (ts.isForOfStatement(n) || ts.isForInStatement(n)) return make('loop', { a: cv(n.expression), b: cv(n.statement), c: cv(n.initializer) });
    if (ts.isVariableDeclarationList(n)) return make('block', { items: list(n.declarations) });
    if (ts.isWhileStatement(n) || ts.isDoStatement(n)) return make('loop', { a: cv(n.expression), b: cv(n.statement) });
    if (ts.isForStatement(n)) return make('loop', { ...(n.condition ? { a: cv(n.condition) } : {}), b: cv(n.statement), ...(n.initializer ? { c: cv(n.initializer) } : {}) });
    if (ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n) || ts.isEmptyStatement(n)) return make('noop');
    if (n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword || n.kind === ts.SyntaxKind.NullKeyword) return make('literal');
    return make('unsupported', { text: ts.SyntaxKind[n.kind] });
  };
  return { file: file.fileName, text: file.text, statements: file.statements.map(cv), fallback: false };
}

/** Babel lowers only the supported JS subset into the same engine input. */
export function fromJavaScript(file: string, text: string): Source {
  // Babel's heterogeneous node fields are checked by node type below; no customer code executes.
  type B = { type: string; start?: number; end?: number; [key: string]: any };
  const cv = (n: B | null | undefined): Syntax => {
    const make = (k: string, fields: Partial<Syntax> = {}): Syntax => ({ file, start: n?.start ?? 0, end: n?.end ?? 0, k, ...fields });
    if (!n) return make('noop');
    const items = (values: B[]) => values.map(cv);
    switch (n.type) {
      case 'Identifier': return make('id', { text: n.name });
      case 'StringLiteral': case 'NumericLiteral': return make('literal', { text: String(n.value), op: n.type === 'NumericLiteral' ? 'number' : 'string' });
      case 'BooleanLiteral': case 'NullLiteral': return make('literal');
      case 'ImportDeclaration': return make('import', { text: n.source.value, items: n.specifiers.map((s: B) => ({ ...cv(s.local), op: s.type === 'ImportDefaultSpecifier' ? 'default' : s.type === 'ImportNamespaceSpecifier' ? '*' : s.imported.name })) });
      case 'ExportNamedDeclaration': {
        if (n.declaration) { const d = cv(n.declaration); if (d.k === 'block') d.items = (d.items ?? []).map(v => ({ ...v, exported: v.a?.text ?? '' })); else d.exported = d.text ?? ''; return d; }
        return make('export', { ...(n.source ? { text: n.source.value } : {}), items: n.specifiers.map((s: B) => ({ ...cv(s.exported), op: s.local.name })) });
      }
      case 'ExportDefaultDeclaration': return make('exportDefault', { a: cv(n.declaration) });
      case 'VariableDeclaration': return make('block', { op: 'declarations', items: items(n.declarations) });
      case 'VariableDeclarator': return make('variable', { a: cv(n.id), ...(n.init ? { b: cv(n.init) } : {}) });
      case 'ObjectPattern': case 'ArrayPattern': return make(n.type === 'ObjectPattern' ? 'objectPattern' : 'arrayPattern', { items: items(n.properties ?? n.elements) });
      case 'RestElement': return make('property', { a: cv(n.argument), b: cv(n.argument), op: 'rest' });
      case 'AssignmentPattern': return make('variable', { a: cv(n.left), b: cv(n.right) });
      case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression': return make('function', { text: n.id?.name ?? '', params: n.params.map((p: B) => ({ ...cv(p), k: 'variable', a: cv(p) })), a: cv(n.body) });
      case 'BlockStatement': return make('block', { items: items(n.body) });
      case 'ExpressionStatement': return make('expression', { a: cv(n.expression) });
      case 'ReturnStatement': case 'ThrowStatement': return make(n.type === 'ReturnStatement' ? 'return' : 'throw', { ...(n.argument ? { a: cv(n.argument) } : {}) });
      case 'IfStatement': return make('if', { a: cv(n.test), b: cv(n.consequent), ...(n.alternate ? { c: cv(n.alternate) } : {}) });
      case 'ConditionalExpression': return make('conditional', { a: cv(n.test), b: cv(n.consequent), c: cv(n.alternate) });
      case 'MemberExpression': case 'OptionalMemberExpression': return make('member', { a: cv(n.object), b: cv(n.property), op: n.computed ? 'computed' : 'exact' });
      case 'CallExpression': case 'OptionalCallExpression': case 'NewExpression': return make(n.type === 'NewExpression' ? 'new' : 'call', { a: cv(n.callee), items: items(n.arguments) });
      case 'AwaitExpression': case 'SpreadElement': return make('unwrap', { a: cv(n.argument) });
      case 'ObjectExpression': return make('object', { items: items(n.properties) });
      case 'ObjectProperty': return make('property', { a: cv(n.key), b: cv(n.value) });
      case 'ArrayExpression': return make('array', { items: items(n.elements) });
      case 'BinaryExpression': case 'LogicalExpression': case 'AssignmentExpression': return make('binary', { a: cv(n.left), b: cv(n.right), op: n.operator });
      case 'UnaryExpression': case 'UpdateExpression': return make('unary', { a: cv(n.argument), op: n.operator });
      case 'TemplateLiteral': return make('template', { items: items(n.expressions) });
      case 'WhileStatement': case 'DoWhileStatement': case 'ForStatement': return make('loop', { a: cv(n.test), b: cv(n.body), c: cv(n.init) });
      case 'ForOfStatement': case 'ForInStatement': return make('loop', { a: cv(n.right), b: cv(n.body), c: cv(n.left) });
      case 'EmptyStatement': return make('noop');
      default: return make('unsupported', { text: n.type });
    }
  };
  const ast = parse(text, { sourceType: 'unambiguous', plugins: ['jsx'] });
  return { file, text, statements: ast.program.body.map(n => cv(n as B)), fallback: true };
}
