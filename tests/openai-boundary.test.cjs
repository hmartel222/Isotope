const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const changespec = require('@isotope/changespec');
const root = path.resolve(__dirname, '..');
test('Grok spec is selected only with explicit xAI-compatible evidence', async () => {
  const config = { version: 1, language: 'ts', entryPoints: [], mocks: [], returns: {}, failOn: [], ignore: [], reasoner: { mode: 'off' }, repair: { mode: 'off' } };
  const selected = await changespec.loadSpecsForProject(path.join(root, 'specs'), ["import OpenAI from 'openai'; client.responses.create({});"], config);
  assert.deepEqual(selected.specs.map(s => s.id), ['grok.responses.chat-completions']);
  const none = await changespec.loadSpecsForProject(path.join(root, 'specs'), ['export function handler() {}'], config);
  assert.deepEqual(none.specs, []);
});

test('Grok fixtures contain no credentials', async () => {
  const files = await fs.readdir(path.join(root, 'fixtures/normalized/openai-responses-basic'));
  for (const file of files) assert.doesNotMatch(await fs.readFile(path.join(root, 'fixtures/normalized/openai-responses-basic', file), 'utf8'), /sk-[A-Za-z0-9]{20,}/);
});
