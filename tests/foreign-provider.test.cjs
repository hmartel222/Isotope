// The end-to-end invented-provider contract lives in api-agnostic.test.cjs.
// This named guard keeps the harness-boundary deliverable discoverable.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('foreign-provider end-to-end contract pack is registered', () => {
  const contract = fs.readFileSync(path.join(__dirname, 'api-agnostic.test.cjs'), 'utf8');
  assert.match(contract, /invented provider/);
  assert.match(contract, /no provider fallback/);
});
