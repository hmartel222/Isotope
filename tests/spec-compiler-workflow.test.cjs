const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const root = resolve(__dirname, '..');

test('trusted compiler workflow confines sources and owns the only compilation secret', async () => {
  const trusted = await readFile(join(root, '.github/workflows/isotope-compile-spec.yml'), 'utf8');
  const verify = await readFile(join(root, '.github/workflows/isotope-verify.yml'), 'utf8');
  const report = await readFile(join(root, '.github/workflows/isotope-report.yml'), 'utf8');
  assert.match(trusted, /workflow_dispatch/);
  assert.match(trusted, /\.isotope\/sources\/\*/);
  assert.match(trusted, /Source traversal is forbidden/);
  assert.match(trusted, /validate-source-manifest\.mjs/);
  assert.match(trusted, /spec bind-fixtures/);
  assert.match(trusted, /Repository must be a checkout-relative trusted path/);
  assert.match(trusted, /resolverCompatibility/);
  assert.match(trusted, /secrets\.GEMINI_API_KEY/);
  assert.match(trusted, /This workflow never approves a candidate/);
  assert.match(trusted, /node-version: 20/);
  for (const text of [verify, report]) assert.doesNotMatch(text, /GEMINI_API_KEY|pull_request_target|contents:\s*write/);
  assert.match(verify, /change-spec-bundle/);
  assert.match(verify, /github\.event\.pull_request\.head\.sha/);
  assert.match(verify, /pull_request\.base\.sha/);
  assert.match(verify, /git show/);
});

test('Action declares bundle identity and rationale outputs', async () => {
  const action = await readFile(join(root, 'action/action.yml'), 'utf8');
  for (const field of ['change-spec-bundle:', 'change-spec-id:', 'change-spec-bundle-hash:', 'selection-rationale:']) assert.match(action, new RegExp(field));
});
