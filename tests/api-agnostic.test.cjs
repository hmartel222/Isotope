const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const changespec = require('@isotope/changespec');
const harness = require('@isotope/harness-ts');

const root = path.resolve(__dirname, '..');
const baseConfig = {
  version: 1, language: 'ts', entryPoints: [{ file: 'src/handler.ts', export: 'handler', kind: 'express_route' }],
  mocks: [], returns: {}, failOn: ['critical', 'high'], ignore: [],
  reasoner: { mode: 'off', maxInvocations: 10, redact: false },
  repair: { mode: 'off', planner: 'deterministic-only', maxAttempts: 1, maxFiles: 3, maxChangedLines: 80, selfConsistency: false, verify: true, redact: false },
};

test('selection has no provider fallback and rejects ambiguous verified matches', async () => {
  const specs = path.join(root, 'specs');
  const none = await changespec.loadSpecsForProject(specs, ['export function handler() {}'], baseConfig);
  assert.deepEqual(none.specs, []);
  await assert.rejects(
    changespec.loadSpecsForProject(specs, ["import Stripe from 'stripe'; import Acme from 'acme-events';"], baseConfig),
    /Ambiguous ChangeSpecs.*acme\.events\.quota-move.*stripe\.basil\.subscription-period/,
  );
});

test('generic TypeScript adapter handles invented provider, custom header, and identical concurrent identities', async t => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'isotope-api-agnostic-')));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.cp(path.join(root, 'corpus/cases/repositories/acme-typescript/src'), path.join(directory, 'src'), { recursive: true });
  await fs.copyFile(path.join(root, 'corpus/cases/fixtures/acme-events/old.json'), path.join(directory, 'fixture.json'));
  const plan = {
    repositoryRoot: directory,
    entryPoint: { id: 'invented-provider-entry', file: 'src/handler.ts', exportName: 'handler', kind: 'express_route' },
    fixture: { pairId: 'invented-provider-pair', side: 'old', payloadVersion: '1.9.0', payloadPath: 'fixture.json' },
    codeVersion: 'original', runIndex: 0,
    mocks: [
      { module: 'src/db.ts', exports: { db: 'recordAll' }, sinkKind: 'db_write' },
      { module: 'acme-events', strategy: 'provider', adapter: 'fixture-call', exports: ['default'], intercept: ['events.decode'], requestHeaders: { 'x-acme-signature': 'controlled' } },
    ],
    mockReturns: { 'db.jobs.save': { id: 'controlled' } },
    requestHeaders: { 'x-acme-signature': 'controlled' },
  };
  const results = await Promise.all([harness.runTsHarness(plan), harness.runTsHarness(plan), harness.runTsHarness(plan)]);
  assert.deepEqual(results.map(result => result.calls[0].args[0]), [{ quota: 7 }, { quota: 7 }, { quota: 7 }]);
  assert.ok(results.every(result => result.threw === null));
  assert.deepEqual(await fs.readdir(path.join(directory, '.isotope/generated')), []);
});

test('generic production paths contain no provider-specific behavior', async () => {
  const targets = [
    'packages/changespec/src/index.ts', 'packages/cli/src/fixtures.ts', 'packages/cli/src/matrix.ts',
    'packages/cli/src/repair-flow.ts', 'packages/cli/src/scan.ts', 'packages/cli/src/walking-skeleton.ts',
    'packages/harness-ts/src/adapters.ts', 'packages/harness-ts/src/index.ts', 'packages/harness-ts/src/plan.ts',
    'packages/harness-ts/runtime/execution.test.mjs', 'packages/reasoner/src/redact.ts',
    'py-runner/isotope_runner/adapters.py', 'py-runner/isotope_runner/errors.py',
    'py-runner/isotope_runner/harness.py', 'py-runner/isotope_runner/resolver.py',
  ];
  const forbidden = /stripe|elevenlabs|twilio|sendgrid|anthropic|openai|gemini/i;
  for (const relative of targets) {
    const text = await fs.readFile(path.join(root, relative), 'utf8');
    assert.doesNotMatch(text, forbidden, relative);
  }
});
