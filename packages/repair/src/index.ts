import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Node, Project, SyntaxKind, type PropertyAccessExpression } from 'ts-morph';
import {
  validateContract,
  type AppliedCandidate,
  type BDG,
  type CandidatePatch,
  type ChangeSpec,
  type JsonValue,
  type PatchApplicationInput,
  type RepairEligibility,
  type RepairEligibilityInput,
} from '@isotope/core';

export type PredicateResult = { supported: true; value: boolean } | { supported: false; value: false; reason: string };

function payloadObject(payload: JsonValue): unknown {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const data = (payload as Record<string, unknown>).data;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const object = (data as Record<string, unknown>).object;
      if (object && typeof object === 'object') return object;
    }
  }
  return payload;
}

function readPath(root: unknown, path: string): unknown {
  let value = root;
  for (const part of path.split('.')) {
    if (part === 'length') {
      if (!Array.isArray(value) && typeof value !== 'string') return undefined;
      value = value.length;
    } else {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
      value = (value as Record<string, unknown>)[part];
    }
  }
  return value;
}

/** A deliberately tiny, non-executable predicate language for ChangeSpec policy. */
export function evaluateRepairPredicate(expression: string, payload: JsonValue): PredicateResult {
  const source = expression.trim();
  if (source === 'always') return { supported: true, value: true };
  const clauses = source.split(/\s*&&\s*/);
  if (!clauses.length || clauses.some(clause => !clause)) return { supported: false, value: false, reason: 'unsupported_predicate' };
  let result = true;
  for (const clause of clauses) {
    const match = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*(==|!=|>=|<=|>|<)\s*(-?\d+)$/.exec(clause);
    if (!match) return { supported: false, value: false, reason: 'unsupported_predicate' };
    const actual = readPath(payloadObject(payload), match[1]!);
    if (typeof actual !== 'number' || !Number.isFinite(actual)) return { supported: true, value: false };
    const expected = Number(match[3]);
    const comparison = match[2] === '==' ? actual === expected : match[2] === '!=' ? actual !== expected
      : match[2] === '>' ? actual > expected : match[2] === '>=' ? actual >= expected
        : match[2] === '<' ? actual < expected : actual <= expected;
    result = result && comparison;
  }
  return { supported: true, value: result };
}

/** Pure eligibility gate. It never reads source or creates a candidate. */
export function evaluateRepairEligibility(input: RepairEligibilityInput): RepairEligibility {
  const none = (reason: string): RepairEligibility => ({ eligible: false, route: 'none', reason, siteIds: [], changeIndex: null });
  if (input.config.repair.verify !== true) return none('verification_required');
  if (input.config.repair.mode !== 'on') return none('repair_disabled');
  const verdict = input.verdict.verdict;
  if (verdict !== 'FAIL' && verdict !== 'FAIL_REASONED') return none('verdict_not_mechanical_fail');
  if (input.selectedSpecs.specs.length !== 1) return none('requires_one_changespec');
  const spec = input.selectedSpecs.specs[0]!;
  if (!spec.fixtures.heldout_pair || spec.fixtures.heldout_pair === spec.fixtures.pair) return none('held_out_fixture_required');
  const sites = input.bdg.affectedSites.filter(site => site.entryPointId === input.verdict.entryPointId
    && (site.provenance.confidence === 'high' || site.provenance.confidence === 'medium'));
  if (!sites.length) return none('authoritative_site_required');
  const changeIndexes = [...new Set(sites.map(site => site.changeIndex))].sort((a, b) => a - b);
  // Business-policy predicates have precedence over every codemod safety predicate.
  for (const index of changeIndexes) {
    const policy = spec.changes[index]?.repair_policy?.business_policy_required_when;
    if (!policy) continue;
    const decision = evaluateRepairPredicate(policy, input.newPayload);
    if (!decision.supported) return none('unsupported_business_policy_predicate');
    if (decision.value) return none('business_policy_required');
  }
  const siteIds = sites.map(site => site.id).sort();
  const modelRoute = (reasonWhenDisabled: string): RepairEligibility => {
    if (input.config.repair.planner !== 'model') return none(reasonWhenDisabled);
    if (!input.credentialsAvailable) return { eligible: false, route: 'model', reason: 'credentials_unavailable', siteIds: [], changeIndex: null };
    return { eligible: true, route: 'model', reason: 'model_planner', siteIds, changeIndex: changeIndexes[0] ?? 0 };
  };
  // Reasoned incompatibilities never take the path_rename shortcut, even when a codemod exists.
  if (verdict === 'FAIL_REASONED') return modelRoute('planner_disabled');
  const eligibleIndexes = changeIndexes.filter(index => spec.changes[index]?.codemod?.kind === 'path_rename');
  if (!eligibleIndexes.length) return modelRoute('no_safe_deterministic_codemod');
  if (eligibleIndexes.length !== 1) return none('multiple_codemods_ambiguous');
  const changeIndex = eligibleIndexes[0]!;
  const predicate = evaluateRepairPredicate(spec.changes[changeIndex]!.codemod!.safe_when, input.newPayload);
  if (!predicate.supported) return none('unsupported_safe_when_predicate');
  if (!predicate.value) return modelRoute('safe_when_false');
  const eligibleSites = sites.filter(site => site.changeIndex === changeIndex);
  if (!eligibleSites.length) return none('authoritative_site_required');
  return { eligible: true, route: 'deterministic', reason: 'deterministic_codemod_safe', siteIds: eligibleSites.map(site => site.id).sort(), changeIndex };
}

export const checkRepairEligibility = evaluateRepairEligibility;

function repairId(spec: ChangeSpec, entryPointId: string, siteIds: string[]): string {
  return `det-${createHash('sha256').update(JSON.stringify([spec.id, entryPointId, [...siteIds].sort()])).digest('hex').slice(0, 16)}`;
}

function expressionAtSite(sourceFile: ReturnType<Project['addSourceFileAtPath']>, line: number, column: number, terminal: string): PropertyAccessExpression | undefined {
  const position = sourceFile.compilerNode.getPositionOfLineAndCharacter(line - 1, Math.max(0, column - 1));
  let node: Node | undefined = sourceFile.getDescendantAtPos(position);
  const matches: PropertyAccessExpression[] = [];
  while (node) {
    if (Node.isPropertyAccessExpression(node) && node.getName() === terminal && node.getStartLineNumber() === line) matches.push(node);
    node = node.getParent();
  }
  return matches.sort((a, b) => a.getWidth() - b.getWidth())[0];
}

export interface DeterministicCandidateInput {
  repoRoot: string;
  bdg: BDG;
  spec: ChangeSpec;
  entryPointId: string;
  siteIds: string[];
  changeIndex: number;
}

/** Generate bounded AST-anchored edits. This is a hypothesis, never a verified repair. */
export async function generateDeterministicCandidate(input: DeterministicCandidateInput): Promise<CandidatePatch> {
  const change = input.spec.changes[input.changeIndex];
  const codemod = change?.codemod;
  if (!change || !codemod || codemod.kind !== 'path_rename') throw new Error('No deterministic path_rename codemod for selected change');
  const from = /^\$OBJ\.([A-Za-z_$][\w$]*)$/.exec(codemod.from);
  if (!from || !codemod.to.startsWith('$OBJ.')) throw new Error('Unsupported path_rename template');
  const sites = input.siteIds.map(id => input.bdg.affectedSites.find(site => site.id === id)).filter((site): site is NonNullable<typeof site> => Boolean(site));
  if (sites.length !== input.siteIds.length) throw new Error('Candidate sites do not match the BDG');
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const files = new Map<string, { path: string; edits: { anchor: string; replacement: string }[] }>();
  for (const site of [...sites].sort((a, b) => a.location.file.localeCompare(b.location.file) || a.location.line - b.location.line || (a.location.column ?? 1) - (b.location.column ?? 1))) {
    const absolute = resolve(input.repoRoot, site.location.file);
    const sourceFile = project.getSourceFile(absolute) ?? project.addSourceFileAtPath(absolute);
    const expression = expressionAtSite(sourceFile, site.location.line, site.location.column ?? 1, from[1]!);
    if (!expression || expression.getKind() !== SyntaxKind.PropertyAccessExpression) throw new Error(`BDG anchor did not resolve at ${site.location.file}:${site.location.line}:${site.location.column ?? 1}`);
    const objectText = expression.getExpression().getText();
    const anchor = expression.getText();
    if (anchor !== `${objectText}.${from[1]}`) throw new Error(`Affected expression does not match codemod source at ${site.location.file}:${site.location.line}`);
    const replacement = codemod.to.replace('$OBJ', objectText);
    const group = files.get(site.location.file) ?? { path: site.location.file, edits: [] };
    group.edits.push({ anchor, replacement }); files.set(site.location.file, group);
  }
  const id = repairId(input.spec, input.entryPointId, input.siteIds);
  return validateContract('CandidatePatch', {
    repairId: id, classification: 'repair_candidate', confidence: 'high', origin: 'deterministic',
    summary: `Rename ${codemod.from} to ${codemod.to} at ${sites.length} proven provider site${sites.length === 1 ? '' : 's'}`,
    causalChain: `${change.removed_path} was removed; the verified single-cardinality fixture permits ${change.replacement.path}`,
    assumptions: [codemod.safe_when], humanQuestion: null, suspectedInjection: false, abstain: false,
    evidenceRefs: sites.map(site => ({ kind: 'code' as const, file: site.location.file, line: site.location.line })),
    patch: { files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)).map(file => ({ ...file, edits: file.edits.sort((a, b) => a.anchor.localeCompare(b.anchor)) })) },
  });
}

export { buildRepairPacket, assertNoHeldOutLeakage, type RepairPacketBuildInput, type RepairPacketBuildResult } from './packet';
export { planRepair, PLANNER_PROMPT_VERSION, DEFAULT_PLANNER_MODEL, REQUEST_TIMEOUT_MS, type PlanRepairResult } from './plan';

const lockfiles = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'npm-shrinkwrap.json', 'poetry.lock', 'requirements.txt']);
function slash(path: string): string { return path.split(sep).join('/'); }
function normalizeRelative(path: string): string {
  if (!path || isAbsolute(path) || path.includes('\0') || path.includes('\\') || path.split('/').includes('..')) throw new Error(`patch_invalid: unsafe path ${JSON.stringify(path)}`);
  const normalized = slash(relative('/', resolve('/', path)));
  if (!normalized || normalized === '..' || normalized.startsWith('../')) throw new Error(`patch_invalid: unsafe path ${JSON.stringify(path)}`);
  return normalized;
}
function forbidden(path: string): boolean {
  const parts = path.split('/'); const name = basename(path).toLowerCase();
  return name === 'isotope.yml' || path.startsWith('.github/') || path.startsWith('.git/') || path.startsWith('specs/')
    || parts.some(part => ['dist', 'build', 'generated', '.isotope'].includes(part)) || name === 'package.json' || lockfiles.has(name)
    || name === '.env' || name.startsWith('.env.') || /(?:secret|credential|token)/i.test(name);
}
async function assertPhysicalFile(root: string, path: string): Promise<string> {
  const rootReal = await realpath(root); const target = resolve(rootReal, path);
  const rel = relative(rootReal, target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`patch_invalid: path escapes repository: ${path}`);
  let cursor = rootReal;
  for (const part of rel.split(sep)) { cursor = join(cursor, part); if ((await lstat(cursor)).isSymbolicLink()) throw new Error(`patch_invalid: symlink path: ${path}`); }
  const actual = await realpath(target); const actualRel = relative(rootReal, actual);
  if (!actualRel || actualRel === '..' || actualRel.startsWith(`..${sep}`) || isAbsolute(actualRel)) throw new Error(`patch_invalid: resolved path escapes repository: ${path}`);
  return actual;
}
function occurrences(text: string, anchor: string): number {
  let count = 0; let offset = 0;
  while ((offset = text.indexOf(anchor, offset)) !== -1) { count++; offset += Math.max(anchor.length, 1); }
  return count;
}
function changedLines(anchor: string, replacement: string): number { return anchor.split('\n').length + replacement.split('\n').length; }

export async function validateCandidatePatch(input: Pick<PatchApplicationInput, 'repoRoot' | 'candidate' | 'allowedPaths' | 'maxFiles' | 'maxChangedLines'>): Promise<void> {
  const candidate = validateContract('CandidatePatch', input.candidate);
  if (candidate.classification !== 'repair_candidate' || !candidate.patch) throw new Error('patch_invalid: candidate has no patch');
  const allowed = new Set(input.allowedPaths.map(normalizeRelative));
  if (candidate.patch.files.length > input.maxFiles) throw new Error('patch_invalid: file budget exceeded');
  let budget = 0; const seenFiles = new Set<string>();
  for (const file of candidate.patch.files) {
    const path = normalizeRelative(file.path);
    if (seenFiles.has(path)) throw new Error(`patch_invalid: duplicate file: ${path}`); seenFiles.add(path);
    if (!allowed.has(path)) throw new Error(`patch_invalid: path is outside BDG allow-list: ${path}`);
    if (forbidden(path)) throw new Error(`patch_invalid: forbidden path: ${path}`);
    const source = await readFile(await assertPhysicalFile(input.repoRoot, path), 'utf8');
    const seenAnchors = new Set<string>();
    for (const edit of file.edits) {
      if (seenAnchors.has(edit.anchor)) throw new Error(`patch_invalid: duplicate anchor in ${path}`); seenAnchors.add(edit.anchor);
      if (occurrences(source, edit.anchor) !== 1) throw new Error(`patch_invalid: anchor must match exactly once in ${path}`);
      budget += changedLines(edit.anchor, edit.replacement);
    }
  }
  if (budget > input.maxChangedLines) throw new Error('patch_invalid: changed-line budget exceeded');
}

async function command(commandName: string, args: string[], cwd: string, accepted = [0]): Promise<{ code: number; stdout: string; stderr: string }> {
  return await new Promise((done, reject) => {
    const child = spawn(commandName, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += String(chunk); }); child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.once('error', reject); child.once('close', code => accepted.includes(code ?? -1) ? done({ code: code ?? 0, stdout, stderr }) : reject(new Error(`${commandName} failed (${code}): ${stderr.slice(-2000)}`)));
  });
}
async function isGit(root: string): Promise<boolean> { try { return (await command('git', ['rev-parse', '--is-inside-work-tree'], root)).stdout.trim() === 'true'; } catch { return false; } }

async function createWorkspace(repoRoot: string, requestedRoot: string | undefined, id: string): Promise<{ root: string; git: boolean }> {
  const base = resolve(requestedRoot ?? process.env.RUNNER_TEMP ?? tmpdir()); await mkdir(base, { recursive: true });
  const root = join(base, `isotope-${id}-${randomUUID().slice(0, 8)}`);
  const git = await isGit(repoRoot);
  try {
    if (git) await command('git', ['worktree', 'add', '--detach', root, 'HEAD'], repoRoot);
    else {
      await mkdir(root, { recursive: true });
      await cp(repoRoot, root, { recursive: true, filter: source => !['node_modules', '.git', '.isotope'].includes(basename(source)) });
    }
    // Deliberately do not link the original node_modules: customer code must never gain a write path to the original dependency tree.
    return { root: await realpath(root), git };
  } catch (error) {
    try { if (git) await command('git', ['worktree', 'remove', '--force', root], repoRoot); } catch { /* best-effort after partial creation */ }
    await rm(root, { recursive: true, force: true }); throw error;
  }
}

async function unifiedDiff(originalRoot: string, workspaceRoot: string, paths: string[]): Promise<string> {
  const sections: string[] = [];
  for (const path of paths) {
    const a = await assertPhysicalFile(originalRoot, path); const b = await assertPhysicalFile(workspaceRoot, path);
    const result = await command('diff', ['-u', '--label', `a/${path}`, '--label', `b/${path}`, a, b], originalRoot, [0, 1]);
    if (result.stdout) sections.push(result.stdout.endsWith('\n') ? result.stdout : `${result.stdout}\n`);
  }
  return sections.join('');
}
function diffStats(diff: string): { added: number; removed: number } {
  let added = 0; let removed = 0;
  for (const line of diff.split('\n')) { if (line.startsWith('+') && !line.startsWith('+++')) added++; else if (line.startsWith('-') && !line.startsWith('---')) removed++; }
  return { added, removed };
}

/** Validate first, then edit only an isolated worktree/copy. Caller must dispose in finally. */
export async function applyCandidatePatch(input: PatchApplicationInput): Promise<AppliedCandidate> {
  if (input.candidate.repairId !== input.repairId) throw new Error('patch_invalid: repair identity mismatch');
  await validateCandidatePatch(input);
  let workspace: { root: string; git: boolean } | undefined;
  try {
    workspace = await createWorkspace(input.repoRoot, input.temporaryRoot, input.repairId);
    const candidate = input.candidate;
    if (candidate.classification !== 'repair_candidate' || !candidate.patch) throw new Error('patch_invalid: candidate has no patch');
    const changedFiles: string[] = [];
    for (const file of candidate.patch.files) {
      const path = normalizeRelative(file.path); const target = await assertPhysicalFile(workspace.root, path);
      let source = await readFile(target, 'utf8');
      for (const edit of file.edits) {
        if (occurrences(source, edit.anchor) !== 1) throw new Error(`patch_invalid: workspace anchor must match exactly once in ${path}`);
        source = source.replace(edit.anchor, edit.replacement);
      }
      await writeFile(target, source, 'utf8'); changedFiles.push(path);
    }
    const diff = await unifiedDiff(input.repoRoot, workspace.root, changedFiles);
    const stats = diffStats(diff);
    if (changedFiles.length > input.maxFiles || stats.added + stats.removed > input.maxChangedLines) throw new Error('patch_invalid: actual diff exceeds configured budget');
    let disposed = false; const captured = workspace;
    return { repairId: input.repairId, workspaceRoot: workspace.root, diff, changedFiles, linesAdded: stats.added, linesRemoved: stats.removed,
      dispose: async () => { if (disposed) return; disposed = true; try { if (captured.git) await command('git', ['worktree', 'remove', '--force', captured.root], input.repoRoot); } finally { await rm(captured.root, { recursive: true, force: true }); } } };
  } catch (error) {
    if (workspace) { try { if (workspace.git) await command('git', ['worktree', 'remove', '--force', workspace.root], input.repoRoot); } finally { await rm(workspace.root, { recursive: true, force: true }); } }
    throw error;
  }
}

/** The only supported application scope: cleanup is guaranteed even when verification throws. */
export async function withAppliedCandidate<T>(input: PatchApplicationInput, operation: (applied: AppliedCandidate) => Promise<T>): Promise<T> {
  const applied = await applyCandidatePatch(input);
  try { return await operation(applied); }
  finally { await applied.dispose(); }
}

export function allowedPathsFromBDG(bdg: BDG, entryPointId: string): string[] {
  return [...new Set(bdg.affectedSites.filter(site => site.entryPointId === entryPointId && site.sinkNodeIds.length > 0).map(site => normalizeRelative(site.location.file)))].sort();
}

export interface RepositoryIntegritySnapshot { status: string; hashes: Record<string, string> }
export async function snapshotRepositoryIntegrity(repoRoot: string, paths: string[]): Promise<RepositoryIntegritySnapshot> {
  const hashes: Record<string, string> = {};
  for (const path of [...new Set(paths.map(normalizeRelative))].sort()) hashes[path] = createHash('sha256').update(await readFile(await assertPhysicalFile(repoRoot, path))).digest('hex');
  const status = await isGit(repoRoot) ? (await command('git', ['status', '--porcelain=v1', '--untracked-files=all', '--', '.', ':(exclude).isotope'], repoRoot)).stdout : '';
  return { status, hashes };
}
export async function assertRepositoryIntegrity(repoRoot: string, expected: RepositoryIntegritySnapshot): Promise<void> {
  const actual = await snapshotRepositoryIntegrity(repoRoot, Object.keys(expected.hashes));
  if (actual.status !== expected.status || JSON.stringify(actual.hashes) !== JSON.stringify(expected.hashes)) throw new Error('Original checkout changed during repair verification');
}
