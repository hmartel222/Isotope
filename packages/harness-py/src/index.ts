import { spawn } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateContract, type HarnessInput, type HarnessResult, type Signature } from '@isotope/core';
import { HarnessExecutionError } from './errors';
export { HarnessExecutionError } from './errors';

function sidecar(): string { return resolve(__dirname, '../../../py-runner/isotope_runner/cli.py'); }

function python(payload: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('python3', [sidecar()], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    child.stdout.on('data', chunk => out.push(chunk as Buffer));
    child.on('error', error => reject((error as NodeJS.ErrnoException).code === 'ENOENT'
      ? new HarnessExecutionError('harness_could_not_run', 'python3 is required for Python execution') : error));
    child.on('close', () => {
      try { resolvePromise(JSON.parse(Buffer.concat(out).toString('utf8')) as Record<string, unknown>); }
      catch { reject(new HarnessExecutionError('invalid_child_output', 'Python harness returned invalid JSON')); }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

async function runOnce(input: HarnessInput, side: 'old' | 'new', runIndex: number): Promise<Signature> {
  if (input.entryPoint.language !== 'py') throw new HarnessExecutionError('unsupported_harness_plan', 'Python harness requires a Python entry point');
  const root = await realpath(input.repoRoot);
  const entryFile = await realpath(resolve(root, input.entryPoint.file));
  const payloadPath = side === 'old' ? input.fixture.oldPath : input.fixture.newPath;
  const fixturePayload = JSON.parse(await readFile(payloadPath, 'utf8')) as unknown;
  const plan = {
    repositoryRoot: root, entryFile,
    entryPoint: { id: input.entryPoint.id, file: input.entryPoint.file, exportName: input.entryPoint.export, kind: input.entryPoint.kind },
    fixture: { pairId: input.fixture.id, side, payloadVersion: side === 'old' ? input.fixture.oldVersion : input.fixture.newVersion, payloadPath },
    fixturePayload, codeVersion: input.codeVersion, mocks: input.config.mocks, mockReturns: input.config.returns, runIndex,
  };
  const result = await python({ command: 'harness', plan });
  if (result.error) {
    const error = result.error as { reason?: string; message?: string };
    throw new HarnessExecutionError((error.reason as HarnessExecutionError['reason']) || 'harness_could_not_run', error.message || 'Python harness failed');
  }
  const signature = validateContract('Signature', result.signature);
  if (signature.entryPointId !== input.entryPoint.id || signature.runIndex !== runIndex) throw new HarnessExecutionError('invalid_child_output', 'Signature does not match execution identity');
  return signature;
}

export async function runHarness(input: HarnessInput): Promise<HarnessResult> {
  return {
    old: [await runOnce(input, 'old', 0), await runOnce(input, 'old', 1)],
    new: [await runOnce(input, 'new', 0), await runOnce(input, 'new', 1)],
  };
}
