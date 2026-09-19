import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { validateContract, writeJsonArtifact, type HarnessInput, type HarnessResult, type Signature } from '@isotope/core';
import { HarnessExecutionError } from './errors';
import { assertWithin, createTsHarnessPlan, isLocalModule, projectFile, type TsHarnessPlan } from './plan';
import { getAdapter } from './adapters';
import { resolveProviderAdapter } from './provider-adapters';
export { serializeBehavior } from './serialize';
export { createRecorder } from './mocks';
export { HarnessExecutionError } from './errors';
export { createTsHarnessPlan } from './plan';
export type { TsHarnessPlan } from './plan';
export type { HandlerAdapter, AdapterContext, AdapterResult } from './adapters';
export const DEFAULT_TIMEOUT_MS = 20_000;
function runtimeAsset(name: string): string {
  if (process.env.ISOTOPE_ACTION_RUNTIME_ROOT) return name === 'block-net.cjs' ? resolve(process.env.ISOTOPE_ACTION_RUNTIME_ROOT, '..', name) : resolve(process.env.ISOTOPE_ACTION_RUNTIME_ROOT, name);
  return name === 'block-net.cjs' ? resolve(__dirname, '..', name) : resolve(__dirname, '../runtime', name);
}

/** Validate the protocol and its association with this execution, not just its shape. */
export function acceptChildResult(value: unknown, plan: TsHarnessPlan): Signature {
  try {
    const result = value as { signature?: unknown; error?: { reason: string; message: string; diagnostics?: Record<string, unknown> } };
    if (!result || typeof result !== 'object') throw new Error('Expected a result object');
    if (result.error) {
      const reasons = ['provider_stub_not_exercised', 'blocked_egress', 'harness_timeout', 'harness_could_not_run', 'unsupported_behavior_serialization', 'serialization_limit', 'adapter_not_implemented'];
      if (!reasons.includes(result.error.reason) || typeof result.error.message !== 'string' || result.signature) throw new Error('Invalid failure envelope');
      throw new HarnessExecutionError(result.error.reason as ConstructorParameters<typeof HarnessExecutionError>[0], result.error.message.slice(0, 8192), result.error.diagnostics);
    }
    const signature = validateContract('Signature', result.signature);
    if (signature.entryPointId !== plan.entryPoint.id || signature.codeVersion !== plan.codeVersion || signature.payloadVersion !== plan.fixture.payloadVersion || signature.fixturePair !== plan.fixture.pairId || signature.runIndex !== plan.runIndex || signature.calls.some((c, i) => c.seq !== i)) throw new Error('Signature does not match execution identity or call sequence');
    return signature;
  } catch (error) {
    if (error instanceof HarnessExecutionError) throw error;
    throw new HarnessExecutionError('invalid_child_output', `Invalid child result: ${String(error)}`);
  }
}

async function generatedDirectory(root: string): Promise<string> {
  let current = root;
  for (const part of ['.isotope', 'generated']) {
    current = join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Symlinked generated directory'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await mkdir(current, { recursive: true });
  }
  return current;
}

/** One fresh child and Vitest context per invocation. No verdict or BDG knowledge. */
async function executeTsHarness(plan: TsHarnessPlan, options: { timeoutMs?: number } = {}): Promise<Signature> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new HarnessExecutionError('unsupported_harness_plan', 'timeoutMs must be between 1 and 120000');
  getAdapter(plan.entryPoint.kind);
  if (!Number.isInteger(plan.runIndex) || plan.runIndex < 0 || !plan.entryPoint.id || !plan.entryPoint.exportName || !plan.fixture.pairId || !['old', 'new'].includes(plan.fixture.side)) throw new HarnessExecutionError('unsupported_harness_plan', 'Invalid execution identity');
  const root = await realpath(plan.repositoryRoot);
  const entryFile = await projectFile(root, plan.entryPoint.file);
  // Fixtures may be explicit external files: normalized provider artifacts are shared across repos.
  const fixturePath = await realpath(resolve(root, plan.fixture.payloadPath));
  const mocks = await Promise.all(plan.mocks.map(async mock => {
    const normalized = 'strategy' in mock && !mock.providerAdapter
      ? { ...mock, providerAdapter: resolveProviderAdapter(mock) }
      : mock;
    if ('strategy' in normalized) {
      const descriptor = normalized.providerAdapter;
      if (!descriptor || descriptor.module !== normalized.module) throw new HarnessExecutionError('unsupported_harness_plan', `Invalid provider adapter for module ${normalized.module}`);
    }
    if (normalized.module.startsWith('node:')) throw new HarnessExecutionError('unsupported_harness_plan', 'Built-in modules cannot be configured as observable mocks');
    return { ...normalized, module: isLocalModule(normalized.module) ? await projectFile(root, normalized.module) : normalized.module };
  }));
  if (new Set(mocks.map(m => m.module)).size !== mocks.length) throw new HarnessExecutionError('unsupported_harness_plan', 'Duplicate mock modules');
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'isotope-harness-')));
  let specPath: string | undefined;
  let ownsSpec = false;
  try {
    const generated = await generatedDirectory(root);
    const key = createHash('sha256').update(JSON.stringify([plan.entryPoint, plan.fixture, plan.codeVersion, plan.runIndex])).digest('hex').slice(0, 16);
    specPath = join(generated, `${key}.${randomUUID()}.${plan.fixture.side}.${plan.runIndex}.spec.ts`);
    // Exclusive creation prevents concurrent invocations with the same identity from racing.
    await writeFile(specPath, `// Generated execution wrapper; not an authoritative artifact.\nimport ${JSON.stringify(runtimeAsset('execution.test.mjs'))};\n`, { flag: 'wx' });
    ownsSpec = true;
    const resultPath = join(directory, 'result.json');
    const planPath = join(directory, 'plan.json');
    await writeFile(planPath, JSON.stringify({ ...plan, repositoryRoot: root, entryFile, mocks, fixturePath, resultPath, specPath }), { mode: 0o600 });
    const runtime = runtimeAsset('runner.mjs');
    const preload = runtimeAsset('block-net.cjs');
    const outcome = await new Promise<{ code: number | null; signal: string | null; stdout: string; stderr: string; timedOut: boolean }>((done, reject) => {
      const child = spawn(process.execPath, [runtime, planPath], {
        cwd: root, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: process.env.PATH ?? '', HOME: directory, TMPDIR: directory, CI: '1', NO_COLOR: '1', TZ: 'UTC',
          NODE_OPTIONS: `--require ${JSON.stringify(preload)}`, ISOTOPE_EGRESS_LOG: join(directory, 'egress.jsonl') },
      });
      let stdout = ''; let stderr = ''; let timedOut = false;
      const kill = () => {
        try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); }
        catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'EPERM') { try { child.kill('SIGKILL'); } catch { /* process already exited */ } }
          else if (code !== 'ESRCH') throw error;
        }
      };
      const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
      child.stdout.on('data', data => { stdout = (stdout + String(data)).slice(-16384); });
      child.stderr.on('data', data => { stderr = (stderr + String(data)).slice(-16384); });
      child.once('error', error => { clearTimeout(timer); kill(); reject(error); });
      child.once('exit', () => { kill(); }); // Reap pool descendants even after a runner crash.
      child.once('close', (code, signal) => { clearTimeout(timer); done({ code, signal, stdout, stderr, timedOut }); });
    });
    const diagnostics = { entryPointId: plan.entryPoint.id, stage: 'child', generatedTestPath: specPath, ...outcome };
    let egress = '';
    try { egress = await readFile(join(directory, 'egress.jsonl'), 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (egress) throw new HarnessExecutionError('blocked_egress', 'Unexpected outbound I/O was blocked; configure the missing boundary', { ...diagnostics, attempts: egress.slice(0, 4096) });
    if (outcome.timedOut) throw new HarnessExecutionError('harness_timeout', `Harness exceeded ${timeoutMs}ms; child process group terminated`, diagnostics);
    if (outcome.code !== 0) throw new HarnessExecutionError('harness_could_not_run', `Harness child exited ${outcome.code ?? outcome.signal}`, diagnostics);
    let result: unknown;
    try {
      if ((await lstat(resultPath)).size > 8 * 1024 * 1024) throw new Error('Result exceeds 8 MiB');
      result = JSON.parse(await readFile(resultPath, 'utf8')) as unknown;
    } catch (error) { throw new HarnessExecutionError('invalid_child_output', `Missing or malformed result: ${String(error)}`, diagnostics); }
    let signature: Signature;
    try { signature = acceptChildResult(result, plan); }
    catch (error) { if (error instanceof HarnessExecutionError) throw new HarnessExecutionError(error.reason, error.message, { ...diagnostics, ...error.diagnostics }); throw error; }
    if (plan.outputPath) {
      try { await writeJsonArtifact(root, assertWithin(root, resolve(root, plan.outputPath)), 'Signature', signature); }
      catch (error) { throw new HarnessExecutionError('artifact_write_failed', String(error), diagnostics); }
    }
    return signature;
  } catch (error) {
    if (error instanceof HarnessExecutionError) throw error;
    throw new HarnessExecutionError('harness_could_not_run', String(error), { entryPointId: plan.entryPoint.id, generatedTestPath: specPath });
  } finally {
    if (ownsSpec && specPath) await rm(specPath, { force: true });
    await rm(directory, { recursive: true, force: true });
  }
}

/** All preparation, process and protocol errors use the typed L3 failure channel. */
export async function runTsHarness(plan: TsHarnessPlan, options: { timeoutMs?: number } = {}): Promise<Signature> {
  try { return await executeTsHarness(plan, options); }
  catch (error) {
    if (error instanceof HarnessExecutionError) throw error;
    throw new HarnessExecutionError('harness_could_not_run', String(error));
  }
}

/** Compatibility stage API; config translation is also exported for orchestrators/L10. */
export async function runHarness(input: HarnessInput): Promise<HarnessResult> {
  if (input.entryPoint.language !== 'ts') throw new HarnessExecutionError('unsupported_harness_plan', 'TypeScript harness requires a TypeScript entry point');
  return {
    old: [await runTsHarness(createTsHarnessPlan(input, 'old', 0)), await runTsHarness(createTsHarnessPlan(input, 'old', 1))],
    new: [await runTsHarness(createTsHarnessPlan(input, 'new', 0)), await runTsHarness(createTsHarnessPlan(input, 'new', 1))],
  };
}
