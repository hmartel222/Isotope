const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  createRegistry, getBuiltinRegistry, matchProviderForDependency, createProviderStub, getBoundaryForModule,
  envelopePrefixFor, listProviders, stripeProvider, accountsProvider, itemsProvider,
} = require('@isotope/providers');
const { loadSpecsForProject } = require('@isotope/changespec');
const { createTsHarnessPlan, runTsHarness } = require('@isotope/harness-ts');
const { verifyWalkingSkeleton } = require('@isotope/cli');
const { REASONER_SYSTEM_PROMPT } = require('@isotope/reasoner');
const { renderPrComment, buildAnnotations } = require('@isotope/reporter');
const { fixtures, clone } = require('./fixtures/contracts.cjs');

const root = path.resolve(__dirname, '..');
const emptyConfig = {
  version: 1, language: 'ts', entryPoints: [{ file: 'src/handler.ts', export: 'handler', kind: 'plain' }],
  mocks: [], returns: {}, failOn: ['critical'], reasoner: { mode: 'off', maxInvocations: 1, redact: false },
  repair: { mode: 'off', planner: 'deterministic-only', maxAttempts: 1, maxFiles: 1, maxChangedLines: 10, selfConsistency: false, verify: true, redact: false },
  ignore: [],
};

test('provider registry rejects duplicates and unknown ids', () => {
  const registry = createRegistry([accountsProvider]);
  assert.equal(registry.get('isotope-accounts').id, 'isotope-accounts');
  assert.throws(() => registry.register(accountsProvider), /Duplicate provider id/);
  assert.throws(() => registry.get('missing'), /Unknown provider/);
  assert.deepEqual(registry.list().map(p => p.id), ['isotope-accounts']);
});

test('dependency matching is deterministic and rejects ambiguity', () => {
  const extra = { ...accountsProvider, id: 'extra', boundaries: undefined, dependencyMatchers: [{ ecosystem: 'npm', package: 'stripe' }] };
  const registry = createRegistry([stripeProvider, extra]);
  assert.throws(() => registry.match({ ecosystem: 'npm', package: 'stripe' }), /Ambiguous providers/);
  assert.equal(createRegistry([accountsProvider]).match({ ecosystem: 'npm', package: '@isotope/test-accounts' }).id, 'isotope-accounts');
});

test('duplicate boundary modules are rejected', () => {
  const cloneProvider = { ...accountsProvider, id: 'accounts-clone' };
  assert.throws(() => createRegistry([accountsProvider, cloneProvider]), /Ambiguous boundary module/);
});

test('builtin enumeration is sorted by id and includes Stripe plus synthetic providers', () => {
  const ids = listProviders().map(p => p.id);
  assert.deepEqual(ids, [...ids].sort());
  for (const id of ['stripe', 'isotope-accounts', 'isotope-items', 'googlemaps', 'elevenlabs', 'snowflake']) assert.ok(ids.includes(id));
});

test('Stripe can be omitted from a registry while another provider still matches', () => {
  const registry = createRegistry([accountsProvider, itemsProvider]);
  assert.throws(() => registry.get('stripe'), /Unknown provider/);
  assert.equal(registry.match({ ecosystem: 'npm', package: '@isotope/test-items' }).id, 'isotope-items');
});

test('plug-and-play registration does not require Stripe or core pipeline edits', () => {
  const registry = createRegistry([{
    id: 'acme', displayName: 'Acme', capabilities: ['dependencyMatching', 'outboundSdkBoundary'],
    dependencyMatchers: [{ ecosystem: 'npm', package: 'acme-sdk' }],
    boundaries: [{ module: 'acme-sdk', namedExports: ['Client'], createStub() { return { Client: class Client {}, default: class Client {} }; } }],
  }]);
  assert.equal(registry.match({ ecosystem: 'npm', package: 'acme-sdk' }).id, 'acme');
  assert.throws(() => registry.get('stripe'), /Unknown provider/);
  assert.equal(registry.requireCapability('acme', 'outboundSdkBoundary').id, 'acme');
  assert.throws(() => registry.requireCapability('acme', 'incomingBoundary'), /does not implement incomingBoundary/);
});

test('unsupported capability is explicit', () => {
  assert.throws(() => getBuiltinRegistry().requireCapability('elevenlabs', 'incomingBoundary'), /does not implement incomingBoundary/);
  getBuiltinRegistry().requireCapability('stripe', 'incomingBoundary');
});

test('loadSpecsForProject does not fall back to Stripe for an unmatched project', async () => {
  const selected = await loadSpecsForProject(path.join(root, 'specs'), ['export function handler() { return 1; }'], emptyConfig);
  assert.equal(selected.specs.length, 0);
});

test('synthetic accounts provider is selected from package mentions', async () => {
  const repo = path.join(root, 'corpus/cases/repositories/isotope-accounts');
  const selected = await loadSpecsForProject(path.join(root, 'specs'), [await fs.readFile(path.join(repo, 'src/handler.ts'), 'utf8')], JSON.parse(await fs.readFile(path.join(repo, 'isotope.yml'), 'utf8')));
  assert.equal(selected.specs[0].provider, 'isotope-accounts');
});

test('boundary stubs cover webhook, SDK retrieve, and list shapes', async () => {
  assert.deepEqual(envelopePrefixFor('stripe'), ['data', 'object']);
  assert.deepEqual(envelopePrefixFor('isotope-accounts'), []);
  const stripe = createProviderStub('stripe', { fixture: { id: 'evt' }, onProviderInvoke() {}, recorder: () => () => ({}) });
  assert.deepEqual(new stripe.Stripe().webhooks.constructEvent(), { id: 'evt' });
  const accounts = createProviderStub('@isotope/test-accounts', { fixture: { renewal: 1 }, onProviderInvoke() {}, recorder() { return () => {}; } });
  assert.deepEqual(await new accounts.Client().accounts.retrieve(), { renewal: 1 });
  const items = createProviderStub('@isotope/test-items', { fixture: { items: [1] }, onProviderInvoke() {}, recorder() { return () => {}; } });
  assert.deepEqual(await new items.Client().items.list(), { items: [1] });
  assert.equal(getBoundaryForModule('missing-sdk'), undefined);
  assert.throws(() => createProviderStub('missing-sdk', { fixture: {}, onProviderInvoke() {}, recorder() { return () => {}; } }), /No provider boundary/);
});

test('harness plans take request headers from the selected boundary, not a Stripe constant', () => {
  const base = {
    repoRoot: root, codeVersion: 'original',
    fixture: { id: 'p', role: 'planning', oldPath: 'o', newPath: 'n', oldVersion: 'a', newVersion: 'b' },
    config: { ...emptyConfig, mocks: [{ module: 'stripe', strategy: 'provider' }] },
    entryPoint: { id: 'ep', file: 'x.ts', export: 'handler', kind: 'express_route', language: 'ts' },
  };
  const stripePlan = createTsHarnessPlan(base, 'old', 0);
  assert.equal(stripePlan.provider.requestHeaders['stripe-signature'], 'isotope-mocked-signature');
  const accountsPlan = createTsHarnessPlan({
    ...base, config: { ...emptyConfig, mocks: [{ module: '@isotope/test-accounts', strategy: 'provider' }] },
    entryPoint: { ...base.entryPoint, kind: 'plain' },
  }, 'old', 0);
  assert.deepEqual(accountsPlan.provider.requestHeaders, {});
});

test('unknown provider mocks fail before execution and do not fall back to Stripe', async () => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'isotope-unknown-provider-')));
  await fs.mkdir(path.join(directory, 'src'));
  await fs.writeFile(path.join(directory, 'src/handler.ts'), 'export function handler() { return 1; }');
  await assert.rejects(runTsHarness({
    repositoryRoot: directory,
    entryPoint: { id: 'ep', file: 'src/handler.ts', exportName: 'handler', kind: 'plain' },
    fixture: { pairId: 'x', side: 'old', payloadVersion: '1', payloadPath: path.join(root, 'corpus/cases/fixtures/accounts-renewal/old.json') },
    codeVersion: 'original', mocks: [{ module: 'not-a-registered-provider', strategy: 'provider' }], mockReturns: {},
    provider: { requireWebhookInterception: false, requireProviderInterception: false, requestHeaders: {} }, runIndex: 0,
  }), /Unsupported provider/);
});

test('differ classifications do not depend on provider identity strings', async () => {
  const { diffSignatures } = require('@isotope/differ');
  const signature = (pair) => ({
    entryPointId: 'ep', codeVersion: 'original', payloadVersion: '1', fixturePair: pair, runIndex: 0,
    returned: { ok: true }, threw: null, calls: [{ seq: 0, mock: 'db.x.update', sinkKind: 'db_write', args: [{ n: 1 }] }], durationMs: 1,
  });
  const bdg = { schemaVersion: 1, entryPoints: [], nodes: [], edges: [], sinks: [], affectedSites: [], skipped: [] };
  const a = diffSignatures({ old: signature('stripe'), new: signature('stripe'), bdg, selfComparisons: { old: [signature('stripe'), signature('stripe')], new: [signature('stripe'), signature('stripe')] } });
  const b = diffSignatures({ old: signature('isotope-items'), new: signature('isotope-items'), bdg, selfComparisons: { old: [signature('isotope-items'), signature('isotope-items')], new: [signature('isotope-items'), signature('isotope-items')] } });
  assert.equal(a.divergences.length, 0);
  assert.equal(b.divergences.length, 0);
});

test('reasoner system prompt contains no hardcoded Stripe semantics', () => {
  assert.doesNotMatch(REASONER_SYSTEM_PROMPT, /Stripe|constructEvent|current_period_end/i);
});

test('reporter templates use selected provider identity rather than hardcoded Stripe wording', () => {
  const report = clone(fixtures.IsotopeReport); report.verdict.verdict = 'FAIL'; report.verdict.results[0].verdict = 'FAIL';
  const selected = clone(fixtures.SelectedSpecs);
  selected.dependencyChanges[0].package = '@isotope/test-accounts';
  selected.specs[0].provider = 'isotope-accounts';
  const bdg = clone(fixtures.BDG);
  bdg.affectedSites[0].provenance.provider = 'isotope-accounts';
  const text = renderPrComment({ report, selected, bdg, diffs: [clone(fixtures.DiffReport)], signatures: [clone(fixtures.Signature)] });
  assert.match(text, /test-accounts/);
  assert.doesNotMatch(text, /Stripe upgrade|Stripe payload|Stripe migration/);
  assert.match(buildAnnotations({ report, selected, bdg, diffs: [], signatures: [] })[0].message, /isotope-accounts/);
  selected.dependencyChanges[0].package = 'stripe';
  selected.specs[0].provider = 'stripe';
  bdg.affectedSites[0].provenance.provider = 'stripe';
  const stripeText = renderPrComment({ report, selected, bdg, diffs: [clone(fixtures.DiffReport)], signatures: [clone(fixtures.Signature)] });
  assert.match(stripeText, /`stripe`/);
});

test('builtin matching does not silently choose Stripe for another package', () => {
  assert.equal(matchProviderForDependency({ ecosystem: 'npm', package: '@isotope/test-accounts' }).id, 'isotope-accounts');
  assert.throws(() => matchProviderForDependency({ ecosystem: 'npm', package: 'unknown-sdk' }), /No provider matches/);
});

async function verifySynthetic(t, repoName, fixturesDir) {
  const repo = path.join(root, 'corpus/cases/repositories', repoName);
  const selected = await loadSpecsForProject(path.join(root, 'specs'), [await fs.readFile(path.join(repo, 'src/handler.ts'), 'utf8')], JSON.parse(await fs.readFile(path.join(repo, 'isotope.yml'), 'utf8')));
  const artifactRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), `isotope-${repoName}-`)));
  t.after(() => fs.rm(artifactRoot, { recursive: true, force: true }));
  return verifyWalkingSkeleton({
    configPath: path.join(repo, 'isotope.yml'), selectedSpecs: selected, disableReasoner: true, disableRepair: true,
    testFixtureDirectory: path.join(root, 'corpus/cases/fixtures', fixturesDir), artifactProjectRoot: artifactRoot,
  });
}

test('synthetic accounts provider is an ESCALATE type_changed case', async t => {
  const { report, exitCode, diff } = await verifySynthetic(t, 'isotope-accounts', 'accounts-renewal');
  assert.equal(report.verdict.verdict, 'ESCALATE');
  assert.equal(exitCode, 3);
  assert.ok(diff?.divergences.some(d => d.kind === 'type_changed'));
});

test('synthetic items provider is a mechanical FAIL value_to_missing case', async t => {
  const { report, exitCode, diff } = await verifySynthetic(t, 'isotope-items', 'items-list');
  assert.equal(report.verdict.verdict, 'FAIL');
  assert.equal(exitCode, 1);
  assert.ok(diff?.divergences.some(d => d.kind === 'value_to_missing'));
});
