const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readdirSync, readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const { NotImplementedStageError } = require('@isotope/core');
const packages = ['core','changespec','resolver-ts','resolver-py','harness-ts','harness-py','differ','reasoner','repair','verifier','reporter','fleet','cli'];
for (const name of packages) test(`package ${name} imports and stubs never fake success`, () => {
  const api = require(`@isotope/${name}`);
  assert.ok(Object.keys(api).length);
  if (!['core', 'cli', 'harness-ts', 'differ', 'changespec', 'resolver-ts'].includes(name)) for (const fn of Object.values(api)) assert.throws(() => fn({}), NotImplementedStageError);
});
test('aggregate verdict resolution remains explicitly unimplemented', () => {
  const core = require('@isotope/core');
  assert.throws(() => core.resolveAggregateVerdict([]), NotImplementedStageError);
});
test('package graph is acyclic; CLI orchestrates while subsystems depend only on core', () => {
  const manifests = Object.fromEntries(packages.map(p => [p, JSON.parse(readFileSync(path.join(root, 'packages',p,'package.json'),'utf8'))]));
  const active = new Set(); const done = new Set();
  function visit(p) {
    assert.ok(!active.has(p), `Cycle at ${p}`); if (done.has(p)) return;
    active.add(p);
    for (const dependency of Object.keys(manifests[p].dependencies || {})) if (dependency.startsWith('@isotope/')) {
      assert.notEqual(p, 'core'); if (p !== 'cli') assert.equal(dependency, '@isotope/core'); visit(dependency.slice(9));
    }
    active.delete(p); done.add(p);
  }
  packages.forEach(visit);
});
function cli(args) { return spawnSync(process.execPath, ['packages/cli/dist/bin.js', ...args], { cwd: root, encoding: 'utf8' }); }
test('CLI top-level help lists every required command form', () => {
  const result = cli(['--help']); assert.equal(result.status, 0, result.stderr);
  for (const command of ['scan', 'verify', 'repair', 'explain', 'fleet', 'spec', 'fixtures', 'matrix', 'accuracy', '--no-reasoner', '--no-repair', 'validate|draft|list', 'fixtures normalize', '--explain <repairId>']) assert.ok(result.stdout.includes(command), command);
});
const commands = [['repair','ep-test'], ['repair','--explain','r1'], ['explain','ep-test'], ['fleet','--repos','corpus/repos.json','--spec','test','--out','dashboard.html','--reason','--repair'], ['spec','validate'], ['spec','draft','--url','https://example.invalid','--provider','test'], ['spec','list'], ['fixtures','normalize'], ['matrix'], ['accuracy']];
for (const args of commands) test(`CLI ${args.join(' ')} parses and fails explicitly`, () => {
  const result = cli(args); assert.equal(result.status, 12, result.stderr); assert.match(result.stderr, /not implemented yet/); assert.doesNotMatch(result.stdout, /PASS|verified repair/i);
});
for (const args of [['repair'], ['repair','ep','--explain','r1'], ['explain'], ['spec','draft'], ['verify','--typo'], ['unknown']]) test(`CLI rejects invalid arguments ${args.join(' ')}`, () => assert.equal(cli(args).status, 10));
test('nested command help succeeds', () => {
  for (const args of [['verify','--help'], ['repair','--help'], ['spec','--help'], ['fixtures','--help']]) assert.equal(cli(args).status, 0);
});
test('product fixture directories contain no invented payloads', () => {
  for (const directory of ['fixtures/raw', 'fixtures/normalized']) {
    for (const file of readdirSync(path.join(root,directory), {recursive:true})) if (file.endsWith('.json')) {
      const text = readFileSync(path.join(root,directory,file),'utf8');
      assert.doesNotMatch(text,/SYNTHETIC_ONLY/); assert.notEqual(JSON.parse(text).synthetic,true);
    }
  }
  assert.deepEqual(readdirSync(path.join(root,'corpus')), ['README.md']);
});

test('Phase 2 verify flags parse and require a real configuration', () => {
  for (const args of [['verify'], ['verify','--no-reasoner'], ['verify','--no-repair']]) {
    const result = cli(args); assert.equal(result.status,10); assert.match(result.stderr,/isotope.yml/);
  }
});
