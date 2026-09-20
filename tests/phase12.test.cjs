const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { draftSpec, loadSpecsForProject } = require('@isotope/changespec');
const { resolveBehavioralDependencyGraph } = require('@isotope/resolver-py');
const { runHarness } = require('@isotope/harness-py');
const { verifyWalkingSkeleton } = require('@isotope/cli');
const { validateContract } = require('@isotope/core');
const root = path.resolve(__dirname, '..');

test('draft ChangeSpecs are marked draft and never load as walking-skeleton specs', async () => {
  const spec = await draftSpec({ url: 'https://example.invalid/changelog', provider: 'acme' });
  assert.equal(spec.verified_by, 'draft');
  assert.equal(spec.changes[0].codemod.kind, 'unsupported');
  assert.throws(() => validateContract('SelectedSpecs', { schemaVersion: 1, dependencyChanges: [], specs: [spec] }), /verified_by|verified_at/);
});

test('Python ElevenLabs corpus is a mechanical FAIL', async t => {
  const repo = path.join(root, 'corpus/cases/repositories/python-elevenlabs');
  const selected = await loadSpecsForProject(path.join(root, 'specs'), [await fs.readFile(path.join(repo, 'handler.py'), 'utf8')], JSON.parse(await fs.readFile(path.join(repo, 'isotope.yml'), 'utf8')));
  assert.equal(selected.specs[0].id, 'elevenlabs.generate.voice-rename');
  const artifactRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'isotope-py-')));
  t.after(() => fs.rm(artifactRoot, { recursive: true, force: true }));
  const result = await verifyWalkingSkeleton({
    configPath: path.join(repo, 'isotope.yml'), selectedSpecs: selected, disableReasoner: true, disableRepair: true,
    testFixtureDirectory: path.join(root, 'corpus/cases/fixtures/el-tts'),
    artifactProjectRoot: artifactRoot,
  });
  assert.equal(result.report.verdict.verdict, 'FAIL');
  assert.equal(result.exitCode, 1);
});

test('language auto routes Python files to the Python resolver', async () => {
  const repo = path.join(root, 'corpus/cases/repositories/python-elevenlabs');
  const config = JSON.parse(await fs.readFile(path.join(repo, 'isotope.yml'), 'utf8'));
  const eleven = (await require('@isotope/changespec').loadHumanSpecs(path.join(root, 'specs'))).find(s => s.provider === 'elevenlabs');
  const bdg = await resolveBehavioralDependencyGraph({ repositoryRoot: repo, config, changeSpec: eleven });
  assert.equal(bdg.entryPoints[0].language, 'py');
  assert.ok(bdg.affectedSites.length >= 1);
  const harness = await runHarness({
    repoRoot: repo, config, entryPoint: bdg.entryPoints[0], bdg,
    fixture: { id: 'el-tts', role: 'planning', oldPath: path.join(root, 'corpus/cases/fixtures/el-tts/old.json'), newPath: path.join(root, 'corpus/cases/fixtures/el-tts/new.json'), oldVersion: '0.2.27', newVersion: '1.0.0' },
    codeVersion: 'original',
  });
  assert.equal(harness.old[0].threw, null);
  assert.equal(harness.new[0].threw, null);
});

test('Python resolver proves the cross-module provider-to-repository flow without a root/sink cross-product', async () => {
  const repo = path.join(root, 'elevenlabs-v2-generate-removal');
  const config = JSON.parse(await fs.readFile(path.join(repo, 'isotope.yml'), 'utf8'));
  const spec = await require('@isotope/changespec').loadSpecById(path.join(repo, 'specs'), 'elevenlabs.python.v1-v2.generate-removal');
  const bdg = await resolveBehavioralDependencyGraph({ repositoryRoot: repo, config, changeSpec: spec });
  const providerRoots = bdg.nodes.filter(node => node.kind === 'taint_root');
  assert.equal(providerRoots.length, 1);
  assert.equal(bdg.sinks.length, 1);
  assert.equal(bdg.edges.length, 1);
  assert.deepEqual(bdg.edges[0], { from: providerRoots[0].id, to: bdg.sinks[0].nodeId, kind: 'flows_to', pathSuffix: '' });
  assert.deepEqual(bdg.affectedSites[0].sinkNodeIds, [bdg.sinks[0].nodeId]);
});

test('Python resolver does not connect an unrelated provider result to a constant repository write', async t => {
  const repo = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'isotope-py-flow-')));
  t.after(() => fs.rm(repo, { recursive: true, force: true }));
  await fs.writeFile(path.join(repo, 'entry.py'), [
    'from service import synthesize',
    'from repository import Repository',
    'def run(payload):',
    '    synthesize()',
    '    repository = Repository()',
    '    repository.save(content=b"constant")',
    '    return {"status": "stored"}',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(repo, 'service.py'), [
    'from invented_sdk.client import Client',
    'def synthesize():',
    '    return Client().generate()',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(repo, 'repository.py'), [
    'class Repository:',
    '    def save(self, *, content):',
    '        return len(content)',
    '',
  ].join('\n'));
  const config = {
    version: 1, language: 'py', entryPoints: [{ file: 'entry.py', export: 'run', kind: 'plain' }],
    mocks: [
      { module: 'invented_sdk.client', strategy: 'provider', adapter: 'fixture-call', exports: ['Client'], intercept: ['Client.generate'] },
      { module: 'repository', adapter: 'method-record', exports: { 'Repository.save': 'recordAll' }, sinkKind: 'db_write' },
    ], returns: {}, failOn: ['critical', 'high'], reasoner: { mode: 'off', maxInvocations: 0, redact: false },
    repair: { mode: 'off', planner: 'deterministic-only', maxAttempts: 1, maxFiles: 1, maxChangedLines: 10, selfConsistency: false, verify: true, redact: false }, ignore: [],
  };
  const changeSpec = {
    id: 'invented.generate.removal', provider: 'invented', title: 'Generated value changed', source: 'https://example.invalid/change',
    verified_by: 'human', verified_at: '2026-09-19', versions: { from: '1.0.0', to: '2.0.0' }, semantics: 'Test-only provider-neutral flow.',
    detection: { ecosystems: { pypi: { packages: ['invented-sdk'], breaking_from: '2.0.0' } }, taint_roots: [{ kind: 'call', language: 'py', pattern: '$CLIENT.generate($$$)' }] },
    changes: [{ object: 'generation', removed_symbol: 'generate', replacement: { path: 'create', cardinality: 'one' } }], fixtures: { pair: 'invented' },
  };
  const bdg = await resolveBehavioralDependencyGraph({ repositoryRoot: repo, config, changeSpec });
  assert.equal(bdg.nodes.filter(node => node.kind === 'taint_root').length, 1);
  assert.deepEqual(bdg.sinks, []);
  assert.deepEqual(bdg.edges, []);
  assert.deepEqual(bdg.affectedSites, []);
});
