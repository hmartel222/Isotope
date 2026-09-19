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

async function verifyMaps(t, repoName) {
  const repo = path.join(root, 'corpus/cases/repositories', repoName);
  const selected = await loadSpecsForProject(path.join(root, 'specs'), [await fs.readFile(path.join(repo, 'src/handler.ts'), 'utf8')], JSON.parse(await fs.readFile(path.join(repo, 'isotope.yml'), 'utf8')));
  assert.equal(selected.specs[0].id, 'googlemaps.places.legacy-to-new');
  const artifactRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'isotope-gmaps-')));
  t.after(() => fs.rm(artifactRoot, { recursive: true, force: true }));
  return verifyWalkingSkeleton({
    configPath: path.join(repo, 'isotope.yml'), selectedSpecs: selected, disableReasoner: true, disableRepair: true,
    testFixtureDirectory: path.join(root, 'corpus/cases/fixtures/places-details'),
    artifactProjectRoot: artifactRoot,
  });
}

test('loadSpecsForProject selects Google Maps from package mentions, not a Stripe default', async () => {
  const repo = path.join(root, 'corpus/cases/repositories/googlemaps-places');
  const selected = await loadSpecsForProject(path.join(root, 'specs'), [await fs.readFile(path.join(repo, 'src/handler.ts'), 'utf8')], JSON.parse(await fs.readFile(path.join(repo, 'isotope.yml'), 'utf8')));
  assert.equal(selected.specs[0].id, 'googlemaps.places.legacy-to-new');
  assert.equal(selected.specs[0].provider, 'googlemaps');
});

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

test('Google Maps Places Legacy to New is a mechanical FAIL', async t => {
  const { report, exitCode, diff } = await verifyMaps(t, 'googlemaps-places');
  assert.equal(report.verdict.verdict, 'FAIL');
  assert.equal(exitCode, 1);
  assert.ok(diff?.divergences.some(d => d.kind === 'value_to_missing'));
});

test('Google Maps Places migrated consumer is a mechanical PASS', async t => {
  const { report, exitCode, diff } = await verifyMaps(t, 'googlemaps-places-migrated');
  assert.equal(report.verdict.verdict, 'PASS');
  assert.equal(exitCode, 0);
  assert.equal(diff?.divergences.filter(d => d.severity === 'critical' || d.severity === 'high').length ?? 0, 0);
});

test('Google Maps Places unguarded read is a loud FAIL', async t => {
  const { report, exitCode, diff } = await verifyMaps(t, 'googlemaps-places-throw');
  assert.equal(report.verdict.verdict, 'FAIL');
  assert.equal(exitCode, 1);
  assert.ok(diff?.divergences.some(d => d.kind === 'threw_new_only'));
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

async function verifySynthetic(t, repoName, fixtureDir, specId) {
  const repo = path.join(root, 'corpus/cases/repositories', repoName);
  const selected = await loadSpecsForProject(path.join(root, 'specs'), [await fs.readFile(path.join(repo, 'src/handler.ts'), 'utf8')], JSON.parse(await fs.readFile(path.join(repo, 'isotope.yml'), 'utf8')));
  assert.equal(selected.specs[0].id, specId);
  const artifactRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), `isotope-${repoName}-`)));
  t.after(() => fs.rm(artifactRoot, { recursive: true, force: true }));
  return verifyWalkingSkeleton({
    configPath: path.join(repo, 'isotope.yml'), selectedSpecs: selected, disableReasoner: true, disableRepair: true,
    testFixtureDirectory: path.join(root, 'corpus/cases/fixtures', fixtureDir), artifactProjectRoot: artifactRoot,
  });
}

test('synthetic accounts SDK provider is selected without Stripe', async t => {
  const { report, exitCode, diff } = await verifySynthetic(t, 'isotope-accounts', 'accounts-renewal', 'isotope-accounts.renewal-object');
  assert.equal(report.verdict.verdict, 'ESCALATE');
  assert.equal(exitCode, 3);
  assert.ok(diff?.divergences.some(d => d.kind === 'type_changed'));
});

test('synthetic items list provider is selected without Stripe', async t => {
  const { report, exitCode, diff } = await verifySynthetic(t, 'isotope-items', 'items-list', 'isotope-items.list-envelope');
  assert.equal(report.verdict.verdict, 'FAIL');
  assert.equal(exitCode, 1);
  assert.ok(diff?.divergences.some(d => d.kind === 'value_to_missing'));
});
