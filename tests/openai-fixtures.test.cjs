const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const root = path.resolve(__dirname, '..');
const spec = { versions: { from: '4.0.0', to: '5.0.0' } };

test('OpenAI fixture pairs preserve old/new response contracts and metadata', async () => {
  const dir = path.join(root, 'fixtures/normalized/openai-responses-basic');
  const metadata = JSON.parse(await fs.readFile(path.join(dir, 'meta.json')));
  const oldPayload = JSON.parse(await fs.readFile(path.join(dir, 'old.json')));
  const newPayload = JSON.parse(await fs.readFile(path.join(dir, 'new.json')));
  assert.equal(metadata.provider, 'grok');
  assert.equal(oldPayload.choices[0].message.content, 'Hello from Isotope');
  assert.equal(newPayload.output_text, 'Hello from Isotope');
  assert.notEqual(metadata.oldVersion, metadata.newVersion);
});

test('OpenAI held-out fixtures are separate from planning payloads', async () => {
  const planning = JSON.parse(await fs.readFile(path.join(root, 'fixtures/normalized/openai-responses-basic/old.json')));
  const heldout = JSON.parse(await fs.readFile(path.join(root, 'fixtures/normalized/openai-heldout/old.json')));
  assert.notEqual(planning.id, heldout.id);
});
