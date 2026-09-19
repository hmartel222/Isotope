// Internal harness worker. This is execution machinery, not the user's test suite.
import { test, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
const require = createRequire(import.meta.url);
const { serializeBehavior } = require('../dist/serialize.js');
const { validateContract } = require('@isotope/core');

test('execute exactly one isolated webhook invocation', async () => {
  const plan = JSON.parse(readFileSync(process.env.ISOTOPE_RUN_PLAN, 'utf8'));
  const calls = [];
  let providerInvocations = 0;
  let blocked = false;
  let instrumentationFailure = null;
  const snapshot = value => {
    try { return serializeBehavior(value); }
    catch (error) { instrumentationFailure = String(error); throw error; }
  };
  const block = () => { blocked = true; throw new Error('IsotopeEgressBlocked'); };
  const started = performance.now();
  try {
    vi.spyOn(http, 'request').mockImplementation(block);
    vi.spyOn(http, 'get').mockImplementation(block);
    vi.spyOn(https, 'request').mockImplementation(block);
    vi.spyOn(https, 'get').mockImplementation(block);
    vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(block);
    vi.stubGlobal('fetch', block);
    vi.resetModules();
    vi.doMock('stripe', () => ({ default: class {
      webhooks = { constructEvent: () => { providerInvocations++; return structuredClone(plan.fixture); } };
    } }));
    vi.doMock(plan.dbFile, () => ({ db: { subscription: { update: async (...args) => {
      // Snapshot at the call boundary, before customer code can mutate its arguments.
      calls.push({ seq: calls.length, mock: 'db.subscription.update', sinkKind: 'db_write', args: snapshot(args) });
      return structuredClone(plan.dbReturn);
    } } } }));
    let returned;
    let threw = null;
    let responseStatus = 200;
    let responseBody;
    let responseSent = false;
    const res = {
      status(code) { responseStatus = code; return res; },
      json(body) { responseBody = snapshot(body); responseSent = true; return res; },
      send(body) { responseBody = snapshot(body); responseSent = true; return res; },
    };
    const body = Buffer.from(JSON.stringify(plan.fixture));
    // Import failures are harness failures, not comparable handler exceptions.
    const mod = await import(plan.entryFile);
    if (typeof mod[plan.exportName] !== 'function') throw new Error(`Missing callable export ${plan.exportName}`);
    try {
      const output = await mod[plan.exportName]({ body, rawBody: body, headers: { 'stripe-signature': 'phase2-mocked-signature' } }, res);
      returned = snapshot(responseSent ? { status: responseStatus, body: responseBody } : output);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      threw = { name: err.name, message: err.message }; // Stack paths are diagnostic, not behavior.
      returned = snapshot(responseSent ? { status: responseStatus, body: responseBody } : undefined);
    }
    if (instrumentationFailure) {
      writeFileSync(plan.resultPath, JSON.stringify({ error: { reason: 'unsupported_behavior_serialization', message: instrumentationFailure } }));
      return;
    }
    if (blocked) {
      writeFileSync(plan.resultPath, JSON.stringify({ error: { reason: 'blocked_egress', message: 'Unexpected outbound I/O was blocked' } }));
      return;
    }
    if (!providerInvocations || (threw && /StripeSignatureVerificationError|signature verification|webhook signature/i.test(`${threw.name} ${threw.message}`))) {
      writeFileSync(plan.resultPath, JSON.stringify({ error: { reason: 'provider_stub_not_exercised', message: 'Stripe constructEvent stub was not exercised successfully; behavior is not trustworthy' } }));
      return;
    }
    const signature = validateContract('Signature', {
      entryPointId: plan.entryPointId, codeVersion: plan.codeVersion, payloadVersion: plan.payloadVersion,
      fixturePair: plan.fixturePair, runIndex: plan.runIndex, returned, threw, calls,
      durationMs: performance.now() - started,
    });
    writeFileSync(plan.resultPath, JSON.stringify({ signature }));
  } catch (error) {
    writeFileSync(plan.resultPath, JSON.stringify({ error: { reason: blocked ? 'blocked_egress' : 'harness_could_not_run', message: String(error) } }));
  } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});
