import type { EntryPoint, JsonValue, Signature } from '@isotope/core';
import { HarnessExecutionError } from './errors';
export interface AdapterContext {
  handler: (...args: any[]) => unknown;
  fixture: JsonValue;
  snapshot(value: unknown): JsonValue;
}
export interface AdapterResult { returned: JsonValue; threw: Signature['threw'] }
export interface HandlerAdapter { invoke(context: AdapterContext): Promise<AdapterResult> }
function customerError(error: unknown): NonNullable<Signature['threw']> {
  if (error instanceof HarnessExecutionError) throw error;
  return { name: (error instanceof Error ? error.name : 'Error').slice(0, 256) || 'Error',
    message: (error instanceof Error ? error.message : String(error)).slice(0, 8192) };
}
const plain: HandlerAdapter = { async invoke({ handler, fixture, snapshot }) {
  let output;
  try { output = await handler(fixture); }
  catch (error) { return { returned: snapshot(undefined), threw: customerError(error) }; }
  return { returned: snapshot(output), threw: null };
} };
const express: HandlerAdapter = { async invoke({ handler, fixture, snapshot }) {
  let status = 200; let body: JsonValue = '__undefined__'; let sent = false;
  const res = {
    get statusCode() { return status; }, set statusCode(code: number) { status = code; },
    status(code: number) { status = code; return res; },
    json(value: unknown) { body = snapshot(value); sent = true; return res; },
    send(value: unknown) { body = snapshot(value); sent = true; return res; },
    end(value?: unknown) { if (value !== undefined) body = snapshot(value); sent = true; return res; },
  };
  const rawBody = Buffer.from(JSON.stringify(fixture));
  let output; let threw: Signature['threw'] = null;
  try { output = await handler({ body: rawBody, rawBody, headers: { 'stripe-signature': 'isotope-mocked-signature' } }, res); }
  catch (error) { threw = customerError(error); }
  return { returned: sent ? { status, body } : snapshot(output), threw };
} };
const registry: Partial<Record<EntryPoint['kind'], HandlerAdapter>> = { plain, express_route: express };
export function getAdapter(kind: EntryPoint['kind']): HandlerAdapter {
  const adapter = registry[kind];
  if (!adapter) throw new HarnessExecutionError('adapter_not_implemented', `Adapter ${kind} is not implemented`);
  return adapter;
}
