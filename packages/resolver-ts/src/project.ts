import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { Project, ts } from 'ts-morph';
import picomatch from 'picomatch';
import type { BDG, ChangeSpec, IsotopeConfig } from '@isotope/core';
import { fromJavaScript, fromTypeScript, type Source } from './syntax';

export const MAX_FILES = 200;
export const slash = (s: string): string => s.replace(/\\/g, '/');
export function localFile(base: string, name: string): string | undefined {
  const target = resolve(base, name);
  const candidates = extname(target) ? [target, ...(/\.[cm]?js$/.test(target) ? [target.replace(/\.[cm]?js$/, '.ts')] : [])] : [target, ...['.ts', '.tsx', '.js', '.mjs', '.cjs', '/index.ts', '/index.js'].map(s => target + s)];
  const found = candidates.find(p => existsSync(p) && statSync(p).isFile());
  return found ? realpathSync(found) : undefined;
}
export interface LoadedProject {
  root: string; sources: Map<string, Source>; diagnostics: BDG['skipped'];
  resolveImport: (file: string, name: string) => string | undefined;
}
export function loadProject(repositoryRoot: string, entries: string[], config: IsotopeConfig, spec: ChangeSpec): LoadedProject {
  const root = realpathSync(repositoryRoot); const diagnostics: BDG['skipped'] = [];
  const ignored = picomatch(config.ignore, { dot: true });
  const safe = (file: string): boolean => {
    const rel = slash(relative(root, file));
    return rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel)
      && !rel.split('/').some(p => ['node_modules', '.git', 'dist', 'build', 'coverage', '.isotope'].includes(p)) && !ignored(rel);
  };
  const tsconfig = join(root, 'tsconfig.json'); let options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, allowJs: true, skipLibCheck: true };
  let usefulConfig = false;
  if (existsSync(tsconfig)) {
    const read = ts.readConfigFile(tsconfig, ts.sys.readFile);
    if (read.error) diagnostics.push({ file: 'tsconfig.json', reason: 'invalid_tsconfig' });
    else {
      const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root);
      if (parsed.errors.some(e => e.code !== 18003 && e.code !== 18002)) diagnostics.push({ file: 'tsconfig.json', reason: 'invalid_tsconfig' });
      else { options = { ...options, ...parsed.options, noEmit: true }; usefulConfig = true; }
    }
  }
  const resolveImport = (file: string, name: string): string | undefined => {
    const resolved = name.startsWith('.') ? localFile(dirname(file), name)
      : ts.resolveModuleName(name, file, options, ts.sys).resolvedModule?.resolvedFileName;
    if (!resolved || !existsSync(resolved)) return undefined;
    const actual = realpathSync(resolved); return safe(actual) ? actual : undefined;
  };
  const admitted = new Map<string, ts.SourceFile>(); const pending = entries.map(e => resolve(root, e)).sort();
  while (pending.length) {
    const requested = pending.shift()!;
    if (!existsSync(requested)) { diagnostics.push({ file: slash(relative(root, requested)), reason: 'source_not_found' }); continue; }
    const file = realpathSync(requested); if (admitted.has(file)) continue;
    if (!safe(file)) { diagnostics.push({ file: slash(relative(root, requested)), reason: 'ignored_or_outside_repository' }); continue; }
    if (admitted.size >= MAX_FILES) { diagnostics.push({ file: slash(relative(root, file)), reason: 'file_limit:200' }); continue; }
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    admitted.set(file, source);
    const imports = new Set<string>();
    const visit = (n: ts.Node): void => {
      if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) imports.add(n.moduleSpecifier.text);
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'require' && n.arguments.length === 1 && ts.isStringLiteral(n.arguments[0]!)) imports.add((n.arguments[0] as ts.StringLiteral).text);
      ts.forEachChild(n, visit);
    }; visit(source);
    for (const name of [...imports].sort()) {
      const resolved = resolveImport(file, name);
      if (resolved) pending.push(resolved);
      else if (name.startsWith('.')) diagnostics.push({ file: slash(relative(root, file)), reason: `unresolved_or_ignored_import:${name}` });
    }
    pending.sort();
  }
  // Only admitted customer files enter the checker. Package declarations remain available as provenance evidence.
  const project = new Project({ compilerOptions: options, skipAddingFilesFromTsConfig: true, skipFileDependencyResolution: true,
    resolutionHost: host => ({ resolveModuleNames: (names, containingFile) => names.map(name => {
      const result = ts.resolveModuleName(name, containingFile, options, host).resolvedModule;
      if (!result) return undefined;
      return result.resolvedFileName.includes('/node_modules/') || admitted.has(realpathSync(result.resolvedFileName)) ? result : undefined;
    }) }),
  });
  for (const file of admitted.keys()) project.addSourceFileAtPath(file);
  const checker = project.getTypeChecker().compilerObject;
  const packages = spec.detection.ecosystems.npm?.packages ?? [];
  const declaredByProvider = (n: ts.Node): boolean => {
    const type = checker.getTypeAtLocation(n);
    const symbols = [type.getSymbol(), type.aliasSymbol, ...(type.isUnionOrIntersection() ? type.types.map(t => t.getSymbol()) : [])];
    return symbols.some(s => s?.getDeclarations()?.some(d => packages.some(p => slash(d.getSourceFile().fileName).includes(`/node_modules/${p}/`))));
  };
  const sources = new Map<string, Source>();
  for (const file of [...admitted.keys()].sort()) {
    const source = project.getSourceFileOrThrow(file);
    if (/\.[cm]?jsx?$/.test(file) && !usefulConfig) {
      sources.set(file, fromJavaScript(file, source.getFullText())); diagnostics.push({ file: slash(relative(root, file)), reason: 'js_fallback:explicit_import_provenance_only' });
    } else {
      const errors = project.getProgram().compilerObject.getSyntacticDiagnostics(source.compilerNode);
      if (errors.length) throw new Error(`Resolver syntax error in ${slash(relative(root, file))}: ${ts.flattenDiagnosticMessageText(errors[0]!.messageText, ' ')}`);
      sources.set(file, fromTypeScript(source.compilerNode, declaredByProvider));
    }
  }
  return { root, sources, diagnostics, resolveImport };
}
