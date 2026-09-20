const test = require('node:test');

function xaiKey() { return (process.env.XAI_API_KEY || '').trim(); }

test('Grok live integration is opt-in', { skip: !xaiKey() }, async () => {
  const key = xaiKey();
  const model = process.env.XAI_TEST_MODEL || 'grok-4.6';
  const endpoint = 'https://api.x.ai/v1/responses';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, input: 'Reply with the word isotope.' }),
    signal: AbortSignal.timeout(30_000),
  });
  const raw = await response.text();
  let body;
  try { body = JSON.parse(raw); } catch { body = { raw: raw.slice(0, 500) }; }
  if (!response.ok) {
    const apiError = body?.error;
    const detail = apiError?.message || body.raw || 'no response body';
    const type = apiError?.type ? ` (${apiError.type})` : '';
    const requestId = response.headers.get('x-request-id');
    throw new Error(`Grok live request failed for ${model}: ${response.status}${type}: ${detail}${requestId ? ` [request ${requestId}]` : ''}`);
  }
  const text = body?.output_text || (Array.isArray(body?.output)
    ? body.output.flatMap(item => Array.isArray(item?.content) ? item.content.map(part => part?.text || '') : []).join('')
    : '');
  if (!text.trim()) throw new Error(`Grok live response did not contain text output (keys: ${Object.keys(body || {}).join(',')})`);
});
