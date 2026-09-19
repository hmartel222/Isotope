const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const root = path.resolve(__dirname, '..');

test('Phase 7 detection matrix distinguishes the five credibility states', async t => {
  const matrixRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'isotope-phase7-results-')));
  t.after(() => fs.rm(matrixRoot, { recursive: true, force: true }));
  const { stdout } = await execute(process.execPath, [path.join(root, 'packages/cli/dist/bin.js'), 'matrix'], { cwd: root, timeout: 120000, env: { ...process.env, ISOTOPE_MATRIX_ROOT: matrixRoot } });
  assert.match(stdout, /5\/5 required cases matched/);
  const summary = JSON.parse(await fs.readFile(path.join(matrixRoot, 'results.json'), 'utf8'));
  assert.equal(summary.group, 'detection'); assert.equal(summary.results.length, 5);
  const byId = Object.fromEntries(summary.results.map(result => [result.id, result]));
  assert.deepEqual(Object.fromEntries(summary.results.map(result => [result.id, result.actualVerdict])), {
    'mechanical-break': 'FAIL', 'migrated-pass': 'PASS', 'noop-pass': 'PASS',
    'wrong-provider-skip': 'SKIP', 'ambiguity-escalate': 'ESCALATE'
  });
  assert.ok(summary.results.every(result => result.acceptance === 'matched'));
  assert.ok(summary.results.filter(result => result.id !== 'wrong-provider-skip').every(result => result.oldStable && result.newStable && result.executionsCompletedNormally));
  assert.equal(byId['mechanical-break'].divergenceKinds[0], 'value_to_missing');
  assert.equal(byId['wrong-provider-skip'].authoritativeSiteCount, 0);
  assert.equal(byId['wrong-provider-skip'].verdictReason, 'no_taint_root');
  assert.equal(byId['ambiguity-escalate'].ambiguityCandidate, true);
  for (const result of summary.results) {
    assert.deepEqual(result.selectedSpecIds, ['stripe.basil.subscription-period']);
    assert.equal(result.repositoryKind, 'internal-controlled');
    await fs.access(path.join(result.artifactRoot, 'selected-specs.json'));
    await fs.access(path.join(result.artifactRoot, 'verdict.json'));
    await fs.access(path.join(result.artifactRoot, 'isotope-report.json'));
  }
  await assert.rejects(fs.access(path.join(byId['wrong-provider-skip'].artifactRoot, 'diff-report.json')), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(byId['wrong-provider-skip'].artifactRoot, 'signatures')), { code: 'ENOENT' });
});
