const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  createRegistry, getBuiltinRegistry, matchProviderForDependency, createProviderStub,
  listProviders, snowflakeProvider, stripeProvider, accountsProvider,
} = require('@isotope/providers');
const { loadSpecsForProject } = require('@isotope/changespec');
const { verifyWalkingSkeleton } = require('@isotope/cli');
const { REASONER_SYSTEM_PROMPT } = require('@isotope/reasoner');
const { renderPrComment } = require('@isotope/reporter');
const { fixtures, clone } = require('./fixtures/contracts.cjs');

const root = path.resolve(__dirname, '..');

test('Snowflake is a registered outbound SDK provider', () => {
  const ids = listProviders().map(p => p.id);
  assert.ok(ids.includes('snowflake'));
  assert.equal(matchProviderForDependency({ ecosystem: 'npm', package: 'snowflake-sdk' }).id, 'snowflake');
  getBuiltinRegistry().requireCapability('snowflake', 'outboundSdkBoundary');
  assert.throws(() => getBuiltinRegistry().requireCapability('snowflake', 'incomingBoundary'), /does not implement incomingBoundary/);
});

test('Snowflake works without Stripe in a controlled registry', () => {
  const registry = createRegistry([snowflakeProvider, accountsProvider]);
  assert.throws(() => registry.get('stripe'), /Unknown provider/);
  assert.equal(registry.match({ ecosystem: 'npm', package: 'snowflake-sdk' }).id, 'snowflake');
});

test('Snowflake execute stub returns fixture rows and throws provider errors', async () => {
  const stub = createProviderStub('snowflake-sdk', {
    fixture: { rows: [{ ACCOUNT_RENEWAL: 1 }] },
    onProviderInvoke() {},
    recorder() { return () => {}; },
  });
  const rows = await stub.createConnection().execute();
  assert.deepEqual(rows, { rows: [{ ACCOUNT_RENEWAL: 1 }] });
  const failing = createProviderStub('snowflake-sdk', {
    fixture: { error: { name: 'OperationFailedError', message: 'SQL compilation error' } },
    onProviderInvoke() {},
    recorder() { return () => {}; },
  });
  await assert.rejects(() => failing.createConnection().execute(), /SQL compilation error/);
});

test('loadSpecsForProject selects Snowflake from snowflake-sdk mentions', async () => {
  const repo = path.join(root, 'corpus/cases/repositories/snowflake-mechanical-break');
  const selected = await loadSpecsForProject(path.join(root, 'specs'), [await fs.readFile(path.join(repo, 'src/handler.ts'), 'utf8')], JSON.parse(await fs.readFile(path.join(repo, 'isotope.yml'), 'utf8')));
  assert.equal(selected.specs[0].id, 'snowflake.query.account-renewal');
  assert.equal(selected.specs[0].provider, 'snowflake');
});

test('reasoner prompt and reporter have no hardcoded Snowflake wording', () => {
  assert.doesNotMatch(REASONER_SYSTEM_PROMPT, /Snowflake|snowflake-sdk|ACCOUNT_RENEWAL/);
  const report = clone(fixtures.IsotopeReport); report.verdict.verdict = 'FAIL'; report.verdict.results[0].verdict = 'FAIL';
  const selected = clone(fixtures.SelectedSpecs);
  selected.dependencyChanges[0].package = 'snowflake-sdk';
  selected.specs[0].provider = 'snowflake';
  const text = renderPrComment({ report, selected, bdg: clone(fixtures.BDG), diffs: [clone(fixtures.DiffReport)], signatures: [clone(fixtures.Signature)] });
  assert.match(text, /snowflake-sdk/);
  assert.doesNotMatch(text, /Snowflake upgrade|Snowflake query/);
});

test('differ classification is identical for equivalent Snowflake and accounts missing values', () => {
  const { diffSignatures } = require('@isotope/differ');
  const signature = (pair, value) => ({
    entryPointId: 'ep', codeVersion: 'original', payloadVersion: '1', fixturePair: pair, runIndex: 0,
    returned: { ok: true }, threw: null, calls: [{ seq: 0, mock: 'db.x.update', sinkKind: 'db_write', args: [{ n: value }] }], durationMs: 1,
  });
  const bdg = { schemaVersion: 1, entryPoints: [], nodes: [], edges: [], sinks: [], affectedSites: [], skipped: [] };
  const snow = diffSignatures({
    old: signature('snowflake', 1), new: signature('snowflake', '__undefined__'), bdg,
    selfComparisons: { old: [signature('snowflake', 1), signature('snowflake', 1)], new: [signature('snowflake', '__undefined__'), signature('snowflake', '__undefined__')] },
  });
  const accounts = diffSignatures({
    old: signature('accounts', 1), new: signature('accounts', '__undefined__'), bdg,
    selfComparisons: { old: [signature('accounts', 1), signature('accounts', 1)], new: [signature('accounts', '__undefined__'), signature('accounts', '__undefined__')] },
  });
  assert.equal(snow.divergences[0].kind, 'value_to_missing');
  assert.equal(accounts.divergences[0].kind, snow.divergences[0].kind);
});

async function verifyCase(t, repoName, fixtureDir) {
  const repo = path.join(root, 'corpus/cases/repositories', repoName);
  const selected = await loadSpecsForProject(path.join(root, 'specs'), [await fs.readFile(path.join(repo, 'src/handler.ts'), 'utf8')], JSON.parse(await fs.readFile(path.join(repo, 'isotope.yml'), 'utf8')));
  const artifactRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), `isotope-${repoName}-`)));
  t.after(() => fs.rm(artifactRoot, { recursive: true, force: true }));
  return verifyWalkingSkeleton({
    configPath: path.join(repo, 'isotope.yml'), selectedSpecs: selected, disableReasoner: true, disableRepair: true,
    testFixtureDirectory: path.join(root, 'corpus/cases/fixtures', fixtureDir), artifactProjectRoot: artifactRoot,
  });
}

test('synthetic Snowflake mechanical break is FAIL value_to_missing', async t => {
  const { report, exitCode, diff } = await verifyCase(t, 'snowflake-mechanical-break', 'snowflake-renewal');
  assert.equal(report.verdict.verdict, 'FAIL');
  assert.equal(exitCode, 1);
  assert.ok(diff?.divergences.some(d => d.kind === 'value_to_missing'));
});

test('synthetic Snowflake migrated consumer is PASS', async t => {
  const { report, exitCode } = await verifyCase(t, 'snowflake-migrated-pass', 'snowflake-renewal');
  assert.equal(report.verdict.verdict, 'PASS');
  assert.equal(exitCode, 0);
});

test('downstream helper hop still FAILs when ACCOUNT_RENEWAL is missing', async t => {
  const { report, exitCode, diff } = await verifyCase(t, 'snowflake-downstream-helper', 'snowflake-renewal');
  assert.equal(report.verdict.verdict, 'FAIL');
  assert.equal(exitCode, 1);
  assert.ok(diff?.divergences.some(d => d.kind === 'value_to_missing' && d.sinkKind === 'db_write'));
});

test('downstream email and http_out record the same missing renewal', async t => {
  const email = await verifyCase(t, 'snowflake-downstream-email', 'snowflake-renewal');
  assert.equal(email.report.verdict.verdict, 'FAIL');
  assert.ok(email.diff?.divergences.some(d => d.sinkKind === 'email' && d.kind === 'value_to_missing'));
  const http = await verifyCase(t, 'snowflake-downstream-http', 'snowflake-renewal');
  assert.equal(http.report.verdict.verdict, 'FAIL');
  assert.ok(http.diff?.divergences.some(d => d.sinkKind === 'http_out' && d.kind === 'value_to_missing'));
});

test('live capture refuses without credentials and does not write corpus', async () => {
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env, SNOWFLAKE_ACCOUNT: '', SNOWFLAKE_PAT: '', SNOWFLAKE_WAREHOUSE: '', SNOWFLAKE_SQL: 'select 1' };
  const result = spawnSync(process.execPath, [path.join(root, 'tools/capture-snowflake.mjs'), '--ping'], {
    env, encoding: 'utf8',
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Missing SNOWFLAKE_/);
});

test('live capture rejects expensive SQL before connecting', async () => {
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env, SNOWFLAKE_ACCOUNT: 'org-acct', SNOWFLAKE_PAT: 'token' };
  const result = spawnSync(process.execPath, [path.join(root, 'tools/capture-snowflake.mjs'), '--side', 'old', '--sql', 'COPY INTO t FROM @stage'], {
    env, encoding: 'utf8',
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Only cheap SELECT/);
});
