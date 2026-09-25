const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdtemp, mkdir, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createFixtureEvidenceBinding } = require('@isotope/fixtures');
const dependencyBinding = { ecosystem: 'npm', package: 'acme', fromVersion: '1.0.0', toVersion: '2.0.0' };

async function fixture(meta = {}, payloads = ['{"old":1}\n', '{"new":1}\n']) {
  const root = await mkdtemp(join(tmpdir(), 'isotope-evidence-')); const dir = join(root, 'pair'); await mkdir(dir);
  await writeFile(join(dir, 'old.json'), payloads[0]); await writeFile(join(dir, 'new.json'), payloads[1]);
  await writeFile(join(dir, 'meta.json'), JSON.stringify({ pair: 'pair', provenance: 'provider-test', oldVersion: '1.0.0', newVersion: '2.0.0', synthetic: false, ...meta }));
  return root;
}
const bind = (root, extra = {}) => createFixtureEvidenceBinding({ fixturesRoot: root, pair: 'pair', dependencyBinding, mode: 'product', ...extra });

test('valid evidence binds normalized metadata and every file hash', async () => {
  const result = await bind(await fixture());
  assert.equal(result.status, 'bound'); assert.equal(result.oldVersion, '1.0.0'); assert.equal(result.synthetic, false);
  for (const file of ['old.json', 'new.json', 'meta.json']) assert.match(result.fixtureHashes[`pair/${file}`], /^[a-f0-9]{64}$/);
});
test('fixture binding rejects missing and invalid JSON files', async () => {
  const missing = await mkdtemp(join(tmpdir(), 'isotope-evidence-')); await mkdir(join(missing, 'pair'));
  await assert.rejects(() => bind(missing), /absent|ENOENT/);
  const invalid = await fixture({}, ['not-json', '{}']);
  await assert.rejects(() => bind(invalid), /invalid JSON/);
});
test('fixture binding rejects pair, version, mode, and held-out collisions', async () => {
  const wrongPair = await fixture({ pair: 'wrong' });
  const wrongVersion = await fixture({ oldVersion: '0.9.0' });
  const synthetic = await fixture({ synthetic: true });
  const collision = await fixture();
  await assert.rejects(() => bind(wrongPair), /does not match/);
  await assert.rejects(() => bind(wrongVersion), /does not match dependency/);
  await assert.rejects(() => bind(synthetic), /Synthetic fixtures are forbidden/);
  await assert.rejects(() => bind(collision, { heldoutPair: 'pair' }), /must differ/);
  const internal = await fixture(); await assert.rejects(() => createFixtureEvidenceBinding({ fixturesRoot: internal, pair: 'pair', dependencyBinding, mode: 'internal-test' }), /must explicitly declare/);
});
test('fixture binding verifies declared payload hashes', async () => {
  const actual = createHash('sha256').update('{"old":1}\n').digest('hex');
  const matching = await fixture({ oldSha256: actual });
  const mismatching = await fixture({ oldSha256: '0'.repeat(64) });
  assert.equal((await bind(matching)).status, 'bound');
  await assert.rejects(() => bind(mismatching), /hash mismatch/);
});
