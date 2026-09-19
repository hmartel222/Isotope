import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { validateContract, type HarnessInput, type HarnessResult, type JsonValue, type Signature } from '@isotope/core';
export { serializeBehavior } from './serialize';
const execute = promisify(execFile);

export class HarnessExecutionError extends Error {
  constructor(readonly reason: string, message: string) { super(message); this.name = 'HarnessExecutionError'; }
}
export interface SingleRunPlan {
  entryFile: string; exportName: string; dbFile: string; fixture: JsonValue;
  entryPointId: string; codeVersion: Signature['codeVersion']; payloadVersion: string; fixturePair: string; runIndex: number;
  dbReturn: JsonValue;
}

/** One real execution in a fresh process; no module, fixture, or mock state is reused. */
export async function runTsHarness(plan: SingleRunPlan): Promise<Signature> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'isotope-harness-')));
  const resultPath = join(directory, 'result.json');
  try {
    const planPath = join(directory, 'plan.json');
    await writeFile(planPath, JSON.stringify({ ...plan, resultPath }), 'utf8');
    const runtime = resolve(__dirname, '../runtime/runner.mjs');
    let executionError: unknown;
    try {
      await execute(process.execPath, [runtime, planPath], {
        cwd: dirname(plan.entryFile), timeout: 20_000, maxBuffer: 1024 * 1024,
        // Deliberately do not forward provider/DB credentials to customer execution.
        env: { PATH: process.env.PATH ?? '', HOME: directory, TMPDIR: directory, CI: '1', NO_COLOR: '1' },
      });
    } catch (error) { executionError = error; }
    let result: { signature?: unknown; error?: { reason: string; message: string } };
    try { result = JSON.parse(await readFile(resultPath, 'utf8')) as typeof result; }
    catch { throw new HarnessExecutionError('harness_could_not_run', `Isolated handler execution produced no result: ${executionError instanceof Error ? executionError.message : 'missing result'}`); }
    if (result.error) throw new HarnessExecutionError(result.error.reason, result.error.message);
    if (executionError) throw new HarnessExecutionError('harness_could_not_run', `Isolated runner failed: ${String(executionError)}`);
    return validateContract('Signature', result.signature);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function projectFile(root: string, file: string): Promise<string> {
  const base = await realpath(root);
  const target = await realpath(resolve(base, file));
  const rel = relative(base, target);
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new HarnessExecutionError('unsupported_harness_plan', 'Phase 2 entry and DB files must be within the specimen');
  return target;
}

/** PHASE 2 LIMITATION: one TS Express-like handler, Stripe, and one DB mock. */
export async function runHarness(input: HarnessInput): Promise<HarnessResult> {
  if (input.entryPoint.kind !== 'express_route' || input.entryPoint.language !== 'ts' || input.config.entryPoints.length !== 1) throw new HarnessExecutionError('unsupported_harness_plan', 'Phase 2 supports one TypeScript express_route entry point');
  const dbMocks = input.config.mocks.filter(mock => 'sinkKind' in mock && mock.sinkKind === 'db_write');
  const dbMock = dbMocks[0];
  if (input.config.mocks.length !== 2 || dbMocks.length !== 1 || !dbMock || !('exports' in dbMock) || dbMock.exports.db !== 'recordAll' || !input.config.mocks.some(mock => mock.module === 'stripe' && 'strategy' in mock && mock.strategy === 'provider')) throw new HarnessExecutionError('unsupported_harness_plan', 'Configure exactly stripe strategy: provider and one db export: recordAll/db_write mock');
  const entryFile = await projectFile(input.repoRoot, input.entryPoint.file);
  const dbFile = await projectFile(input.repoRoot, dbMock.module);
  const dbReturn = input.config.returns['db.subscription.update'];
  if (dbReturn === undefined) throw new HarnessExecutionError('unsupported_harness_plan', 'Configure returns[db.subscription.update]');
  const fixedReturn: JsonValue = dbReturn;
  async function pair(path: string, payloadVersion: string): Promise<[Signature, Signature]> {
    async function run(runIndex: number) {
      // Reload for every process. Customer mutation cannot affect later runs or the disk fixture.
      const fixture = JSON.parse(await readFile(path, 'utf8')) as JsonValue;
      return runTsHarness({ entryFile, dbFile, exportName: input.entryPoint.export, fixture, dbReturn: fixedReturn,
        entryPointId: input.entryPoint.id, codeVersion: input.codeVersion, payloadVersion, fixturePair: input.fixture.id, runIndex });
    }
    return [await run(0), await run(1)];
  }
  return { old: await pair(input.fixture.oldPath, input.fixture.oldVersion), new: await pair(input.fixture.newPath, input.fixture.newVersion) };
}
