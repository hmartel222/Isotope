/**
 * Fixture tooling tests (v3 §13–§17).
 *
 * Every payload in this file is a synthetic INPUT used to prove the normalizer
 * cannot reshape evidence. Nothing here is provider evidence and nothing here
 * is ever written into fixtures/raw or fixtures/normalized — all CLI runs are
 * directed at a temporary --out root.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const TOOL = path.join(root, 'tools/normalize-fixtures.js');
const { collectIdentifiers, applyAliases, aliasValue, assertOnlyAliased, observe } = require('../tools/normalize-fixtures.js');

const clone = value => JSON.parse(JSON.stringify(value));
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');

function temporary(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'isotope-fixtures-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function run(args, cwd = root) {
  return spawnSync(process.execPath, [TOOL, ...args], { cwd, encoding: 'utf8' });
}

/** Synthetic stand-ins shaped like the Basil period move. NOT Stripe evidence. */
const OLD_EVENT = {
  id: 'evt_TESTONLY001', object: 'event', api_version: '2025-02-24.acacia',
  type: 'customer.subscription.updated', created: 1700000000,
  data: { object: { id: 'sub_TESTONLY001', object: 'subscription', customer: 'cus_TESTONLY001', current_period_end: 1700000123, items: { object: 'list', url: '/v1/subscription_items?subscription=sub_TESTONLY001', data: [{ id: 'si_TESTONLY001', object: 'subscription_item', price: { id: 'price_TESTONLY001' } }] } } },
};
const NEW_EVENT = {
  id: 'evt_TESTONLY002', object: 'event', api_version: '2026-08-26.dahlia',
  type: 'customer.subscription.updated', created: 1700000000,
  data: { object: { id: 'sub_TESTONLY001', object: 'subscription', customer: 'cus_TESTONLY001', items: { object: 'list', url: '/v1/subscription_items?subscription=sub_TESTONLY001', data: [{ id: 'si_TESTONLY001', object: 'subscription_item', current_period_end: 1700000123, price: { id: 'price_TESTONLY001' } }] } } },
};

function writePair(dir, oldEvent = OLD_EVENT, newEvent = NEW_EVENT) {
  const rawDir = path.join(dir, 'raw');
  fs.mkdirSync(rawDir, { recursive: true });
  const oldPath = path.join(rawDir, 'old.raw.json');
  const newPath = path.join(rawDir, 'new.raw.json');
  fs.writeFileSync(oldPath, JSON.stringify(oldEvent, null, 2));
  fs.writeFileSync(newPath, JSON.stringify(newEvent, null, 2));
  return { oldPath, newPath, out: path.join(dir, 'normalized') };
}

/* ---------------- the no-reshape guard ---------------- */

test('assertOnlyAliased rejects every class of forbidden reshaping', () => {
  const aliases = new Map([['sub_TESTONLY001', 'sub_A1']]);
  const raw = { a: 1, b: 'sub_TESTONLY001', c: [1, 2], d: { e: true } };
  const ok = aliasValue(raw, aliases);
  assert.doesNotThrow(() => assertOnlyAliased(raw, ok, aliases));

  const cases = [
    ['inserted field', v => { v.inserted = 'x'; return v; }, /key count changed/],
    ['removed field', v => { delete v.a; return v; }, /key count changed/],
    ['reordered keys', v => ({ b: v.b, a: v.a, c: v.c, d: v.d }), /reordered/],
    ['changed number', v => { v.a = 2; return v; }, /scalar changed/],
    ['array length', v => { v.c.push(3); return v; }, /array length changed/],
    ['array reorder', v => { v.c = [2, 1]; return v; }, /scalar changed/],
    ['type change', v => { v.a = '1'; return v; }, /type changed/],
    ['unexplained string', v => { v.b = 'sub_SOMETHING_ELSE'; return v; }, /beyond alias substitution/],
    ['moved field', v => { v.d.a = v.a; delete v.a; return v; }, /key count changed/],
  ];
  for (const [name, mutate, pattern] of cases) {
    assert.throws(() => assertOnlyAliased(raw, mutate(clone(ok)), aliases), pattern, name);
  }
});

test('aliasing preserves key order, array order and every scalar', () => {
  const aliases = collectIdentifiers([OLD_EVENT, NEW_EVENT], 'A');
  const normalized = aliasValue(OLD_EVENT, aliases);
  assert.deepEqual(Object.keys(normalized), Object.keys(OLD_EVENT));
  assert.deepEqual(Object.keys(normalized.data.object), Object.keys(OLD_EVENT.data.object));
  // Timestamps are business values and must survive untouched (§11).
  assert.equal(normalized.data.object.current_period_end, 1700000123);
  assert.equal(normalized.created, 1700000000);
  assert.doesNotThrow(() => assertOnlyAliased(OLD_EVENT, normalized, aliases));
});

test('identifiers alias consistently within a pair and distinctly across pairs', () => {
  const a = collectIdentifiers([OLD_EVENT, NEW_EVENT], 'A');
  // The same live subscription appears in both sides and must map to one alias.
  assert.equal(a.get('sub_TESTONLY001'), 'sub_A1');
  const oldA = aliasValue(OLD_EVENT, a);
  const newA = aliasValue(NEW_EVENT, a);
  assert.equal(oldA.data.object.id, newA.data.object.id);
  // Distinct events keep distinct aliases; identity churn is removed, not identity.
  assert.notEqual(a.get('evt_TESTONLY001'), a.get('evt_TESTONLY002'));

  const b = collectIdentifiers([OLD_EVENT, NEW_EVENT], 'B');
  assert.equal(b.get('sub_TESTONLY001'), 'sub_B1');
  assert.notEqual(a.get('sub_TESTONLY001'), b.get('sub_TESTONLY001'));
});

test('identifiers embedded in URLs are aliased without altering the string shape', () => {
  const aliases = new Map([['sub_TESTONLY001', 'sub_A1']]);
  assert.equal(applyAliases('/v1/subscription_items?subscription=sub_TESTONLY001', aliases), '/v1/subscription_items?subscription=sub_A1');
});

test('observe reports period placement without asserting any expected shape', () => {
  assert.equal(observe(OLD_EVENT).subscriptionLevelPeriodEndPresent, true);
  assert.equal(observe(NEW_EVENT).subscriptionLevelPeriodEndPresent, false);
  assert.deepEqual(observe(NEW_EVENT).itemLevelPeriodEnds, [1700000123]);
});

/* ---------------- CLI behaviour ---------------- */

test('CLI normalizes a pair, records provenance, and verifies clean', t => {
  const dir = temporary(t);
  const { oldPath, newPath, out } = writePair(dir);
  const result = run(['--pair', 'test-pair', '--role', 'planning', '--namespace', 'A', '--old', oldPath, '--new', newPath, '--capture-method', 'B', '--out', out]);
  assert.equal(result.status, 0, result.stderr);

  const meta = JSON.parse(fs.readFileSync(path.join(out, 'test-pair/meta.json'), 'utf8'));
  assert.equal(meta.pair, 'test-pair');
  assert.equal(meta.role, 'planning');
  assert.equal(meta.envelope, 'provider');
  assert.equal(meta.aliasNamespace, 'A');
  assert.equal(meta.old.apiVersion, '2025-02-24.acacia');
  assert.equal(meta.new.apiVersion, '2026-08-26.dahlia');
  assert.equal(meta.old.rawSha256, sha256(fs.readFileSync(oldPath)));
  assert.equal(meta.new.rawSha256, sha256(fs.readFileSync(newPath)));
  // Product fixtures must never claim the internal synthetic test hook.
  assert.notEqual(meta.synthetic, true);

  const normalizedOld = JSON.parse(fs.readFileSync(path.join(out, 'test-pair/old.json'), 'utf8'));
  assert.equal(normalizedOld.data.object.id, 'sub_A1');
  assert.equal(normalizedOld.data.object.current_period_end, 1700000123);

  assert.equal(run(['--verify', '--out', out]).status, 0);
});

test('CLI output is deterministic for the same raw input', t => {
  const dir = temporary(t);
  const { oldPath, newPath } = writePair(dir);
  const outA = path.join(dir, 'a');
  const outB = path.join(dir, 'b');
  for (const out of [outA, outB]) {
    assert.equal(run(['--pair', 'test-pair', '--namespace', 'A', '--old', oldPath, '--new', newPath, '--out', out]).status, 0);
  }
  for (const file of ['old.json', 'new.json']) {
    assert.equal(fs.readFileSync(path.join(outA, 'test-pair', file), 'utf8'), fs.readFileSync(path.join(outB, 'test-pair', file), 'utf8'));
  }
});

test('--verify detects raw evidence tampered with after normalization', t => {
  const dir = temporary(t);
  const { oldPath, newPath, out } = writePair(dir);
  assert.equal(run(['--pair', 'test-pair', '--namespace', 'A', '--old', oldPath, '--new', newPath, '--out', out]).status, 0);
  const tampered = clone(OLD_EVENT);
  tampered.data.object.current_period_end = 1;
  fs.writeFileSync(oldPath, JSON.stringify(tampered, null, 2));
  const result = run(['--verify', '--out', out]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /raw sha256 mismatch/);
});

test('--verify detects a hand-edited normalized fixture', t => {
  const dir = temporary(t);
  const { oldPath, newPath, out } = writePair(dir);
  assert.equal(run(['--pair', 'test-pair', '--namespace', 'A', '--old', oldPath, '--new', newPath, '--out', out]).status, 0);
  const file = path.join(out, 'test-pair/new.json');
  const edited = JSON.parse(fs.readFileSync(file, 'utf8'));
  // The exact forbidden act: making the new payload resemble the old contract.
  edited.data.object.current_period_end = 1700000123;
  fs.writeFileSync(file, JSON.stringify(edited, null, 2));
  const result = run(['--verify', '--out', out]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not an alias-only transform/);
});

test('a second pair may not reuse an alias namespace', t => {
  const dir = temporary(t);
  const { oldPath, newPath, out } = writePair(dir);
  assert.equal(run(['--pair', 'pair-a', '--namespace', 'A', '--old', oldPath, '--new', newPath, '--out', out]).status, 0);
  const collision = run(['--pair', 'pair-b', '--namespace', 'A', '--old', oldPath, '--new', newPath, '--out', out]);
  assert.equal(collision.status, 1);
  assert.match(collision.stderr, /already used by pair pair-a/);
  assert.equal(run(['--pair', 'pair-b', '--namespace', 'B', '--old', oldPath, '--new', newPath, '--out', out]).status, 0);
});

test('CLI refuses credentials, identical api versions, and bad flags', t => {
  const dir = temporary(t);
  const { oldPath, newPath, out } = writePair(dir);

  const leaky = path.join(dir, 'leaky.json');
  fs.writeFileSync(leaky, JSON.stringify({ ...OLD_EVENT, secret: 'sk_test_ABCDEFGHIJKLMNOP' }, null, 2));
  const credential = run(['--pair', 'p', '--namespace', 'A', '--old', leaky, '--new', newPath, '--out', out]);
  assert.equal(credential.status, 1);
  assert.match(credential.stderr, /credential/);

  const same = run(['--pair', 'p', '--namespace', 'A', '--old', oldPath, '--new', oldPath, '--out', out]);
  assert.equal(same.status, 1);
  assert.match(same.stderr, /must span two provider contracts/);

  assert.match(run(['--pair', 'p', '--namespace', 'lower', '--old', oldPath, '--new', newPath, '--out', out]).stderr, /uppercase token/);
  assert.match(run(['--pair', 'p', '--namespace', 'A', '--old', oldPath, '--new', newPath, '--envelope', 'synthetic', '--out', out]).stderr, /capture method C/);
});

test('product fixture directories still contain no synthetic markers', () => {
  for (const directory of ['fixtures/raw', 'fixtures/normalized']) {
    const base = path.join(root, directory);
    if (!fs.existsSync(base)) continue;
    for (const file of fs.readdirSync(base, { recursive: true })) {
      if (!String(file).endsWith('.json')) continue;
      const parsed = JSON.parse(fs.readFileSync(path.join(base, String(file)), 'utf8'));
      assert.notEqual(parsed.synthetic, true, `${directory}/${file} declares the internal synthetic test hook`);
    }
  }
});
