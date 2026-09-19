import { test, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import crypto from 'node:crypto';
const localRequire = createRequire(import.meta.url);
const { serializeBehavior } = localRequire('../dist/serialize.js');
const { createRecorder } = localRequire('../dist/mocks.js');
const { getAdapter } = localRequire('../dist/adapters.js');
const { HarnessExecutionError } = localRequire('../dist/errors.js');
const { validateContract } = localRequire('@isotope/core');
const { createProviderStub, getBoundaryForModule } = localRequire('@isotope/providers');
const network = localRequire('../block-net.cjs');

test('execute one isolated configured entry point', async () => {
  const plan = JSON.parse(readFileSync(process.env.ISOTOPE_RUN_PLAN, 'utf8'));
  const calls = [];
  let providerInvocations = 0;
  let instrumentationFailure;
  let snapshotBytes = 0;
  const started = performance.now();
  const snapshot = value => {
    if (instrumentationFailure) throw instrumentationFailure;
    try {
      const result = serializeBehavior(value, limit => {
        instrumentationFailure = new HarnessExecutionError('serialization_limit', `Behavior exceeded ${limit} bound; truncated evidence is not comparable`);
      });
      snapshotBytes += Buffer.byteLength(JSON.stringify(result));
      if (snapshotBytes > 4 * 1024 * 1024) instrumentationFailure = new HarnessExecutionError('serialization_limit', 'Execution snapshots exceeded 4 MiB');
      if (instrumentationFailure) throw instrumentationFailure;
      return result;
    } catch (error) {
      instrumentationFailure = error instanceof HarnessExecutionError ? error : new HarnessExecutionError('unsupported_behavior_serialization', String(error));
      throw instrumentationFailure;
    }
  };
  try {
    const fixture = JSON.parse(readFileSync(plan.fixturePath, 'utf8'));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    vi.spyOn(Math, 'random').mockReturnValue(0.42);
    const uuid = () => '00000000-0000-4000-8000-000000000000';
    vi.spyOn(crypto, 'randomUUID').mockImplementation(uuid);
    vi.spyOn(crypto.webcrypto, 'randomUUID').mockImplementation(uuid);
    syncBuiltinESMExports();
    if (globalThis.crypto) vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(uuid);
    else vi.stubGlobal('crypto', crypto.webcrypto);
    vi.stubGlobal('fetch', network.block('fetch'));
    vi.spyOn(process, 'exit').mockImplementation(() => {
      instrumentationFailure = new HarnessExecutionError('harness_could_not_run', 'Customer code attempted to exit the harness process');
      throw instrumentationFailure;
    });
    vi.resetModules();
    const failurePatterns = [];
    for (const mock of plan.mocks) {
      if ('strategy' in mock) {
        const requested = mock.requestedModule ?? mock.module;
        const boundary = getBoundaryForModule(requested);
        if (boundary?.interceptionFailurePatterns) failurePatterns.push(...boundary.interceptionFailurePatterns);
        vi.doMock(mock.module, () => createProviderStub(requested, {
          fixture,
          onProviderInvoke: () => { providerInvocations++; },
          recorder: (name, sinkKind) => createRecorder(name, sinkKind, calls, plan.mockReturns, snapshot),
        }));
      } else {
        vi.doMock(mock.module, () => Object.fromEntries(Object.keys(mock.exports).map(name => [
          name, createRecorder(name, mock.sinkKind, calls, plan.mockReturns, snapshot),
        ])));
      }
    }
    const adapter = getAdapter(plan.entryPoint.kind);
    const mod = await import(plan.entryFile);
    const handler = mod[plan.entryPoint.exportName];
    if (typeof handler !== 'function') throw new Error(`Missing callable export ${plan.entryPoint.exportName}`);
    const result = await adapter.invoke({ handler, fixture, snapshot, requestHeaders: plan.provider.requestHeaders ?? {} });
    providerInvocations += Number(globalThis.__isotopeProviderInvocations) || 0;
    if (instrumentationFailure) throw instrumentationFailure;
    if (calls.length >= 5000) throw new HarnessExecutionError('serialization_limit', 'Call count limit reached');
    if (network.attempts.length) throw new HarnessExecutionError('blocked_egress', 'Unexpected outbound I/O was blocked');
    const threwText = result.threw ? `${result.threw.name} ${result.threw.message}` : '';
    const interceptionFailed = failurePatterns.some(pattern => threwText.toLowerCase().includes(pattern.toLowerCase()));
    if (((plan.provider.requireProviderInterception || plan.provider.requireWebhookInterception || (plan.entryPoint.kind !== 'plain' && plan.mocks.some(mock => 'strategy' in mock))) && !providerInvocations) || interceptionFailed) {
      throw new HarnessExecutionError('provider_stub_not_exercised', 'Configured provider interception was not exercised successfully');
    }
    const signature = validateContract('Signature', {
      entryPointId: plan.entryPoint.id, codeVersion: plan.codeVersion, payloadVersion: plan.fixture.payloadVersion,
      fixturePair: plan.fixture.pairId, runIndex: plan.runIndex, ...result, calls,
      durationMs: Math.max(0, performance.now() - started),
    });
    writeFileSync(plan.resultPath, JSON.stringify({ signature }));
  } catch (error) {
    const reason = network.attempts.length ? 'blocked_egress' : error instanceof HarnessExecutionError ? error.reason : 'harness_could_not_run';
    writeFileSync(plan.resultPath, JSON.stringify({ error: { reason, message: String(error).slice(0, 8192) } }));
  } finally {
    vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); syncBuiltinESMExports();
  }
});
