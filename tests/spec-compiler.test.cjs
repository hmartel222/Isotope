const assert = require('node:assert/strict');
const { mkdtemp, mkdir, writeFile } = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const {
  approveEnvelope,
  bindEnvelopeEvidence,
  buildInputPacket,
  compileChangeSpec,
  createEvidenceBinding,
  evaluateApprovalReadiness,
  lowerApprovedEnvelope,
  refreshCompilationReport,
  selectApprovedEnvelope,
} = require('../packages/changespec/dist');
const { validateContract } = require('../packages/core/dist');
const exec = promisify(execFile);

const evidence = 'In 2.0.0 the old field is removed and replaced by new.';
const candidate = {
  schemaVersion: 1,
  provider: 'Acme',
  title: 'Acme field move',
  describedVersions: { from: '1.0.0', to: '2.0.0' },
  semantics: 'The old field moved to new.',
  dependencyProposal: { ecosystem: 'npm', package: 'acme', breakingFrom: '2.0.0' },
  taintRoots: [{ kind: 'call', language: 'ts', receiver: 'acme', members: ['event'], argumentMode: 'wildcard' }],
  changes: [{
    object: 'event',
    removedPath: { segments: [{ kind: 'property', name: 'old' }] },
    replacement: { path: { segments: [{ kind: 'property', name: 'new' }] }, cardinality: 'one' },
    codemod: { kind: 'unsupported' },
    citations: { removed: [{ sourceId: 'change.md', excerpt: evidence }], replacement: [{ sourceId: 'change.md', excerpt: evidence }] },
  }],
  semanticsCitations: [{ sourceId: 'change.md', excerpt: evidence }],
  unknowns: [], unsupportedFeatures: [], suspectedInjection: false, abstain: false,
};

function packet(content = evidence) {
  return buildInputPacket({
    providerHint: 'Acme', dependency: { ecosystem: 'npm', package: 'acme', fromVersion: '1.0.0', toVersion: '2.0.0' },
    supportedLanguages: ['ts'], sources: [{ id: 'change.md', mediaType: 'text/markdown', content }],
  });
}

async function writeProject(root) {
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'node_modules', 'acme'), { recursive: true });
  await writeFile(join(root, 'node_modules', 'acme', 'package.json'), JSON.stringify({ name: 'acme', version: '2.0.0', types: 'index.d.ts' }));
  await writeFile(join(root, 'node_modules', 'acme', 'index.d.ts'), 'declare const client: { event(value: unknown): unknown }; export default client;\n');
  await writeFile(join(root, 'src', 'handler.ts'), "import client from 'acme';\nexport const run = () => client.event({});\n");
  await writeFile(join(root, 'isotope.yml'), `version: 1\nlanguage: ts\nentryPoints:\n  - { file: src/handler.ts, export: run, kind: plain }\nmocks:\n  - { module: acme, strategy: provider }\nreturns: {}\nfailOn: [critical, high]\nreasoner: { mode: off, maxInvocations: 0, redact: true }\nrepair: { mode: off, planner: deterministic-only, maxAttempts: 1, maxFiles: 1, maxChangedLines: 10, selfConsistency: false, verify: true, redact: true }\nignore: []\n`);
}
async function writePair(fixtures, pair) {
  await mkdir(join(fixtures, pair), { recursive: true });
  await writeFile(join(fixtures, pair, 'old.json'), '{"old":1}\n');
  await writeFile(join(fixtures, pair, 'new.json'), '{"new":1}\n');
  await writeFile(join(fixtures, pair, 'meta.json'), JSON.stringify({ pair, provenance: 'provider-test', oldVersion: '1.0.0', newVersion: '2.0.0', synthetic: false }));
}

test('input packets normalize, redact, hash, and detect tampering', () => {
  const built = packet(`${evidence}\r\napi_key=sk-supersecretkey123456789`);
  assert.match(built.sources[0].content, /\[REDACTED\]/);
  assert.doesNotMatch(built.sources[0].content, /supersecret/);
  assert.throws(() => validateContract('ChangeSpecInputPacket', { ...built, dependency: { ...built.dependency, package: 'evil' } }), /inputHash/);
});

test('candidate schema rejects model attempts to set approval or fixtures', () => {
  assert.throws(() => validateContract('ChangeSpecCandidate', { ...candidate, approval: { actor: 'model' } }), /additional properties/);
  assert.throws(() => validateContract('ChangeSpecCandidate', { ...candidate, fixtures: { pair: 'production-pass' } }), /additional properties/);
});

test('compiler validates citations, binds evidence, approves, lowers, and detects mutation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'isotope-compiler-'));
  await writeProject(root);
  const model = { modelId: 'fake-structured-model', async generate() { return { modelId: this.modelId, raw: JSON.stringify(candidate), parsed: candidate, status: 'completed' }; } };
  const compiled = await compileChangeSpec({ packet: packet(), model, repositoryRoot: root });
  assert.equal(compiled.envelope.projectBinding.status, 'bound');
  assert.equal(compiled.report.status, 'evidence_missing');

  const fixtures = join(root, 'fixtures');
  for (const pair of ['main', 'heldout']) await writePair(fixtures, pair);
  const bound = bindEnvelopeEvidence(compiled.envelope, await createEvidenceBinding({ fixturesRoot: fixtures, pair: 'main', heldoutPair: 'heldout', dependencyBinding: compiled.envelope.dependencyBinding }));
  const ready = refreshCompilationReport(bound, compiled.report);
  assert.equal(ready.report.status, 'ready_for_approval');
  const approved = approveEnvelope({ envelope: ready.envelope, report: ready.report, actor: 'reviewer@example.com', approvedAt: '2026-09-21T12:00:00.000Z' });
  const runtime = lowerApprovedEnvelope(approved);
  assert.equal(runtime.verified_by, 'human');
  assert.equal(runtime.detection.taint_roots[0].pattern, '$ACME.event($$$)');
  assert.equal(runtime.fixtures.pair, 'main');

  const tampered = structuredClone(approved);
  tampered.candidate.title = 'tampered';
  assert.throws(() => validateContract('ChangeSpecEnvelope', tampered), /candidateHash|bundleHash/);
  const fixtureTampered = structuredClone(approved);
  fixtureTampered.evidenceBinding.fixtureHashes['main/old.json'] = '0'.repeat(64);
  const { canonicalHash } = require('../packages/core/dist');
  fixtureTampered.bundleHash = canonicalHash({ ...fixtureTampered, bundleHash: undefined });
  assert.throws(() => validateContract('ChangeSpecEnvelope', fixtureTampered), /evidenceHash/);
  const mutatedReport = { ...ready.report, modelId: 'mutated-after-approval' };
  assert.match(evaluateApprovalReadiness(approved, mutatedReport).blockers.join('\n'), /compilation report hash mismatch/);
});

test('compiler rejects citations whose excerpts are not in supplied evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'isotope-citation-'));
  const bad = structuredClone(candidate);
  bad.changes[0].citations.removed[0].excerpt = 'invented claim';
  const model = { modelId: 'fake', async generate() { return { modelId: 'fake', raw: JSON.stringify(bad), parsed: bad, status: 'completed' }; } };
  await assert.rejects(() => compileChangeSpec({ packet: packet(), model, repositoryRoot: root }), /MODEL_OUTPUT_INVALID.*Citation excerpt/);
});

test('approved-envelope selection requires the exact detected package transition', async () => {
  const root = await mkdtemp(join(tmpdir(), 'isotope-selection-'));
  await writeProject(root);
  const model = { modelId: 'fake', async generate() { return { modelId: 'fake', raw: JSON.stringify(candidate), parsed: candidate, status: 'completed' }; } };
  const compiled = await compileChangeSpec({ packet: packet(), model, repositoryRoot: root });
  const fixtures = join(root, 'fixtures');
  await writePair(fixtures, 'main');
  const bound = bindEnvelopeEvidence(compiled.envelope, await createEvidenceBinding({ fixturesRoot: fixtures, pair: 'main', dependencyBinding: compiled.envelope.dependencyBinding }));
  const ready = refreshCompilationReport(bound, compiled.report);
  const approved = approveEnvelope({ envelope: ready.envelope, report: ready.report, actor: 'reviewer@example.com', approvedAt: '2026-09-21T12:00:00.000Z' });
  const bundlePath = join(root, 'bundle.json'); await writeFile(bundlePath, JSON.stringify(approved));
  await exec('git', ['init'], { cwd: root });
  await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  await exec('git', ['config', 'user.name', 'Test'], { cwd: root });
  await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { acme: '1.0.0' } }));
  await exec('git', ['add', '.'], { cwd: root }); await exec('git', ['commit', '-m', 'old'], { cwd: root });
  const baseRef = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { acme: '2.0.0' } }));
  await exec('git', ['add', 'package.json'], { cwd: root }); await exec('git', ['commit', '-m', 'new'], { cwd: root });
  const headRef = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  const selected = await selectApprovedEnvelope({ repositoryRoot: root, baseRef, headRef, bundlePath });
  assert.equal(selected.selected.specs.length, 1);
  assert.equal(selected.bundleHash, approved.bundleHash);
  await assert.rejects(() => selectApprovedEnvelope({ repositoryRoot: root, baseRef: headRef, headRef: baseRef, bundlePath }), /requires exactly one detected transition/);
});

test('approval readiness blocks every unresolved compiler condition', async () => {
  const root = await mkdtemp(join(tmpdir(), 'isotope-readiness-')); await writeProject(root);
  const model = { modelId: 'fake', async generate() { return { modelId: 'fake', raw: JSON.stringify(candidate), parsed: candidate, status: 'completed' }; } };
  const compiled = await compileChangeSpec({ packet: packet(), model, repositoryRoot: root });
  assert.equal(evaluateApprovalReadiness(compiled.envelope, compiled.report).ready, false);
  for (const field of ['unknowns', 'unsupportedFeatures']) {
    const changed = structuredClone(compiled.envelope); changed.candidate[field] = ['unresolved'];
    assert.match(evaluateApprovalReadiness(changed, compiled.report).blockers.join('\n'), /unresolved|unsupported/);
    assert.throws(() => approveEnvelope({ envelope: changed, report: compiled.report, actor: 'reviewer@example.com' }), /Approval blocked/);
  }
  for (const field of ['abstain', 'suspectedInjection']) {
    const changed = structuredClone(compiled.envelope); changed.candidate[field] = true;
    assert.equal(evaluateApprovalReadiness(changed, compiled.report).ready, false);
    assert.throws(() => approveEnvelope({ envelope: changed, report: compiled.report, actor: 'reviewer@example.com' }), /Approval blocked/);
  }
  const badReport = { ...compiled.report, status: 'ready_for_approval', resolverCompatibility: ['unsupported root'], missingEvidence: [] };
  assert.match(evaluateApprovalReadiness(compiled.envelope, badReport).blockers.join('\n'), /resolver compatibility/);
  assert.throws(() => approveEnvelope({ envelope: compiled.envelope, report: badReport, actor: 'reviewer@example.com' }), /Approval blocked/);
});
