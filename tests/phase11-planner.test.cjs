const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { fixtures, clone } = require('./fixtures/contracts.cjs');
const repair = require('@isotope/repair');
const reporter = require('@isotope/reporter');
const { loadWalkingSkeletonSpec } = require('@isotope/changespec');
const { verifyWalkingSkeleton } = require('@isotope/cli');
const { resolveBehavioralDependencyGraph } = require('@isotope/resolver-ts');
const { runHarness } = require('@isotope/harness-ts');
const { diffSignatures } = require('@isotope/differ');
const { resolveVerdict } = require('@isotope/core');
const { verifyRepair } = require('@isotope/verifier');

const root = path.resolve(__dirname, '..');
const cassetteFile = name => JSON.parse(require('fs').readFileSync(path.join(root, 'tests/cassettes/planner', `${name}.json`), 'utf8'));
const reasonerCassette = name => JSON.parse(require('fs').readFileSync(path.join(root, 'tests/cassettes/reasoner', `${name}.json`), 'utf8'));

function bind(vote, user) {
  if (typeof vote !== 'object' || vote === null) return vote;
  const match = /<evidence>\n([\s\S]*?)<\/evidence>/.exec(user);
  if (!match) return vote;
  const packet = JSON.parse(match[1]);
  const next = { ...vote };
  if (packet.diff?.[0]?.pointer) next.evidenceRefs = [{ kind: 'diff', pointer: packet.diff[0].pointer }];
  return next;
}

function model(votes, calls = { n: 0 }) {
  let i = 0;
  return { modelId: 'cassette-planner', classify: async input => {
    calls.n += 1;
    const vote = votes[Math.min(i, votes.length - 1)];
    i += 1;
    if (vote === 'THROW') throw new Error('api down');
    if (typeof vote === 'string') return vote;
    return JSON.stringify(bind(vote, input.user));
  } };
}

function reasonerModel(nameA, nameB, calls = { n: 0 }) {
  const raw = name => { const value = reasonerCassette(name); return value.voteA ?? value; };
  return model([raw(nameA), raw(nameB)], calls);
}

async function corpus(t, name) {
  const repo = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), `isotope-phase11-${name}-`)));
  t.after(() => fs.rm(repo, { recursive: true, force: true }));
  await fs.cp(path.join(root, 'corpus/cases/repositories', name), repo, { recursive: true });
  return repo;
}

test('FAIL_REASONED is model-eligible; mechanical FAIL with safe_when stays deterministic', async () => {
  const selected = await loadWalkingSkeletonSpec(path.join(root, 'specs'));
  const site = { id: 's', entryPointId: 'ep', nodeId: 'n', specId: selected.specs[0].id, changeIndex: 0, location: { file: 'src/a.ts', line: 1, column: 1 }, sinkNodeIds: ['sink'], provenance: { confidence: 'high', provider: 'stripe', specId: selected.specs[0].id, basis: 'provider_call' } };
  const base = {
    bdg: { schemaVersion: 1, entryPoints: [], nodes: [], edges: [], sinks: [], affectedSites: [site], skipped: [] },
    selectedSpecs: selected,
    config: { repair: { mode: 'on', planner: 'model', verify: true, maxAttempts: 1, maxFiles: 3, maxChangedLines: 80, selfConsistency: false, redact: false } },
    fixture: {}, newPayload: { object: 'event', type: 'customer.subscription.updated', api_version: 'new', data: { object: { object: 'subscription', id: 'sub', items: { data: [{ current_period_end: 1 }] } } } },
  };
  const fail = { ...base, verdict: { entryPointId: 'ep', verdict: 'FAIL', provenance: 'mechanical', reason: 'mechanical_incompatibility', divergenceIds: ['d'], reasoningRefs: [], evidenceRefs: [], suspectedInjection: false }, credentialsAvailable: true };
  assert.equal(repair.evaluateRepairEligibility(fail).route, 'deterministic');
  const reasoned = repair.evaluateRepairEligibility({ ...fail, verdict: { ...fail.verdict, verdict: 'FAIL_REASONED', provenance: 'reasoned', reason: 'reasoned_incompatibility' } });
  assert.equal(reasoned.eligible, true); assert.equal(reasoned.route, 'model');
  const off = repair.evaluateRepairEligibility({ ...fail, verdict: { ...fail.verdict, verdict: 'FAIL_REASONED' }, config: { repair: { ...base.config.repair, planner: 'deterministic-only' } } });
  assert.equal(off.reason, 'planner_disabled');
  assert.equal(repair.evaluateRepairEligibility({ ...fail, verdict: { ...fail.verdict, verdict: 'ESCALATE' } }).reason, 'verdict_not_mechanical_fail');
  assert.equal(repair.evaluateRepairEligibility({ ...fail, verdict: { ...fail.verdict, verdict: 'FAIL_REASONED' }, credentialsAvailable: false }).reason, 'credentials_unavailable');
});

test('planner cassettes classify, retry, disagree, and degrade without applying low-confidence patches', async () => {
  const packet = clone(fixtures.RepairPacket);
  const cfg = { ...fixtures.IsotopeConfig.repair, planner: 'model', selfConsistency: false };
  const candidate = cassetteFile('repair-candidate');
  const ok = await repair.planRepair({ packet, config: cfg, repairId: 'r-plan', model: model([candidate]), credentials: true });
  assert.equal(ok.classification, 'repair_candidate'); assert.equal(ok.origin, 'model');
  const human = await repair.planRepair({ packet, config: cfg, repairId: 'r-plan', model: model([cassetteFile('human-decision')]), credentials: true });
  assert.equal(human.classification, 'human_decision_required'); assert.equal(human.patch, null);
  const none = await repair.planRepair({ packet, config: cfg, repairId: 'r-plan', model: model([cassetteFile('no-safe-repair')]), credentials: true });
  assert.equal(none.classification, 'no_safe_repair');
  const low = await repair.planRepair({ packet, config: cfg, repairId: 'r-plan', model: model([cassetteFile('low-confidence')]), credentials: true });
  assert.equal(low.classification, 'no_safe_repair'); assert.equal(low.patch, null);
  const abstain = await repair.planRepair({ packet, config: cfg, repairId: 'r-plan', model: model([cassetteFile('abstain')]), credentials: true });
  assert.equal(abstain.abstain, true); assert.equal(abstain.patch, null);
  const injected = await repair.planRepair({ packet, config: cfg, repairId: 'r-plan', model: model([cassetteFile('injection')]), credentials: true });
  assert.equal(injected.suspectedInjection, true); assert.equal(injected.patch, null);
  const retry = cassetteFile('schema-retry');
  const recovered = await repair.planRepair({ packet, config: cfg, repairId: 'r-plan', model: model([retry.first, retry.retry]), credentials: true });
  assert.equal(recovered.classification, 'repair_candidate');
  const failed = cassetteFile('schema-failure');
  const twice = await repair.planRepair({ packet, config: cfg, repairId: 'r-plan', model: model([failed.first, failed.retry]), credentials: true });
  assert.equal(twice.classification, 'no_safe_repair');
  const down = await repair.planRepair({ packet, config: cfg, repairId: 'r-plan', model: model(['THROW']), credentials: true });
  assert.equal(down.classification, 'no_safe_repair');
  const disagree = cassetteFile('self-consistency-disagreement');
  const split = await repair.planRepair({ packet, config: { ...cfg, selfConsistency: true }, repairId: 'r-plan', model: model([disagree.voteA, disagree.voteB]), credentials: true });
  assert.equal(split.classification, 'human_decision_required'); assert.equal(split.patch, null);
});

test('case 13: FAIL_REASONED coordinated cassette is applied ephemerally and independently verified', { timeout: 120000 }, async t => {
  const repo = await corpus(t, 'corpus-coord');
  const selected = await loadWalkingSkeletonSpec(path.join(root, 'specs'));
  const configPath = path.join(repo, 'isotope.yml');
  const before = await fs.readFile(path.join(repo, 'src/webhook.ts'), 'utf8');
  const plannerCalls = { n: 0 }; const reasonerCalls = { n: 0 };
  const run = await verifyWalkingSkeleton({
    configPath, selectedSpecs: selected, testFixtureDirectory: path.join(root, 'corpus/cases/fixtures/sub-updated-single'),
    disableReasoner: false, disableRepair: false, assumeCredentials: true,
    semanticModel: reasonerModel('incompatibility', 'incompatibility', reasonerCalls),
    plannerModel: model([cassetteFile('repair-candidate')], plannerCalls),
  });
  assert.equal(run.report.verdict.verdict, 'FAIL_REASONED', run.output);
  assert.equal(run.exitCode, 5, run.output);
  assert.equal(run.report.verifiedRepairs.length, 1);
  assert.equal(run.report.repairVerifications[0].outcome, 'verified');
  assert.equal(run.report.verifiedRepairs[0].candidate.origin, 'model');
  assert.equal(run.report.verifiedRepairs[0].offeredOnly, true);
  assert.ok(run.report.repairPacketRefs.length);
  assert.equal(plannerCalls.n, 1);
  assert.equal(await fs.readFile(path.join(repo, 'src/webhook.ts'), 'utf8'), before);
  const packet = JSON.parse(await fs.readFile(path.join(repo, '.isotope', run.report.repairPacketRefs[0]), 'utf8'));
  const serialized = JSON.stringify(packet);
  assert.doesNotMatch(serialized, /sub_heldout/);
  assert.doesNotMatch(serialized, /1701234567/);
  assert.doesNotMatch(serialized, /sub_HELDOUT_UNIQUE/);
  assert.equal(packet.execution.baselineSignature.codeVersion, 'original');
  assert.equal(packet.execution.newSignature.codeVersion, 'original');
  const rendered = reporter.renderPrComment({ report: run.report, selected, bdg: JSON.parse(await fs.readFile(path.join(repo, '.isotope/bdg.json'), 'utf8')), diffs: [], signatures: [], reasoning: [reasonerCassette('incompatibility')] });
  assert.match(rendered, /semantic incompatibility/); assert.match(rendered, /independently verified/); assert.doesNotMatch(rendered, /planner is unavailable/);
});

test('case 14: ESCALATE never calls the planner', { timeout: 120000 }, async t => {
  const repo = await corpus(t, 'human-policy');
  const selected = await loadWalkingSkeletonSpec(path.join(root, 'specs'));
  const configPath = path.join(repo, 'isotope.yml');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8')); config.reasoner.mode = 'on'; config.repair.mode = 'on'; config.repair.planner = 'model';
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  const plannerCalls = { n: 0 };
  const run = await verifyWalkingSkeleton({
    configPath, selectedSpecs: selected, testFixtureDirectory: path.join(root, 'corpus/cases/fixtures/sub-updated-multi'),
    disableReasoner: false, disableRepair: false, assumeCredentials: true,
    semanticModel: reasonerModel('human-decision', 'human-decision'),
    plannerModel: model([cassetteFile('repair-candidate')], plannerCalls),
  });
  assert.equal(run.report.verdict.verdict, 'ESCALATE'); assert.equal(plannerCalls.n, 0); assert.equal(run.report.verifiedRepairs.length, 0); assert.equal(run.report.candidateRefs.length, 0);
});

test('case 15: a schema-valid hardcoded model candidate is rejected by L10', { timeout: 120000 }, async t => {
  const repo = await corpus(t, 'corpus-coord');
  const selected = await loadWalkingSkeletonSpec(path.join(root, 'specs'));
  const config = JSON.parse(await fs.readFile(path.join(repo, 'isotope.yml'), 'utf8'));
  const spec = selected.specs[0];
  const bdg = await resolveBehavioralDependencyGraph({ repositoryRoot: repo, config, changeSpec: spec });
  const entry = bdg.entryPoints[0];
  const makeFixture = async (name, role) => {
    const dir = path.join(root, 'corpus/cases/fixtures', name);
    const old = JSON.parse(await fs.readFile(path.join(dir, 'old.json'), 'utf8'));
    const next = JSON.parse(await fs.readFile(path.join(dir, 'new.json'), 'utf8'));
    return { id: `synthetic-${name}`, role, oldPath: path.join(dir, 'old.json'), newPath: path.join(dir, 'new.json'), oldVersion: old.api_version, newVersion: next.api_version };
  };
  const planning = await makeFixture('sub-updated-single', 'planning');
  const heldOut = await makeFixture('sub-updated-single-B', 'held_out');
  const originalPlanning = await runHarness({ repoRoot: repo, config, entryPoint: entry, bdg, fixture: planning, codeVersion: 'original' });
  const originalHeldOut = await runHarness({ repoRoot: repo, config, entryPoint: entry, bdg, fixture: heldOut, codeVersion: 'original' });
  const originalDiff = diffSignatures({ old: originalPlanning.old[0], new: originalPlanning.new[0], bdg, selfComparisons: originalPlanning });
  const originalVerdict = { ...resolveVerdict({ entryPoint: entry, bdg, diff: originalDiff, reasoning: { status: 'completed', results: [reasonerCassette('incompatibility'), reasonerCassette('incompatibility')], packetRef: 'p', responseRefs: ['a', 'b'] }, config }), verdict: 'FAIL_REASONED', provenance: 'reasoned' };
  const candidate = {
    repairId: 'r-bad', classification: 'repair_candidate', confidence: 'high', origin: 'model', summary: 'hardcode',
    causalChain: 'overfit', assumptions: [], evidenceRefs: [{ kind: 'diff', pointer: (originalDiff.divergences[0] && originalDiff.divergences[0].pointer) || '/calls/0/args/0/data/renewalDate' }],
    humanQuestion: null, suspectedInjection: false, abstain: false,
    patch: { files: [{ path: 'src/webhook.ts', edits: [{ anchor: 'hasLegacyPeriod(object) ? observed : periodEnd(item)', replacement: '1700000123' }] }] },
  };
  const applied = await repair.applyCandidatePatch({ repoRoot: repo, repairId: candidate.repairId, candidate, allowedPaths: ['src/webhook.ts', 'src/period.ts'], maxFiles: 3, maxChangedLines: 80 });
  try {
    const result = await verifyRepair({
      repairId: candidate.repairId, workspaceRoot: applied.workspaceRoot, artifactRoot: repo, candidate, candidateDiff: applied.diff,
      config, selectedSpecs: selected, originalBDG: bdg, entryPoint: entry, originalVerdict,
      planning: { fixture: planning, original: originalPlanning }, heldOut: { fixture: heldOut, original: originalHeldOut },
    });
    assert.ok(['overfit_rejected', 'did_not_restore_behavior', 'degenerate_patch'].includes(result.verification.outcome), result.verification.outcome);
    assert.equal(result.verifiedRepair, null);
  } finally { await applied.dispose(); }
});

test('case 16: planner unavailable leaves reasoned FAIL unresolved and does not block deterministic FAIL repair', { timeout: 120000 }, async t => {
  const previousKey = process.env.GEMINI_API_KEY; const previousInput = process.env.INPUT_GEMINI_API_KEY;
  const previousGoogle = process.env.GOOGLE_API_KEY; const previousGen = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.GEMINI_API_KEY; delete process.env.INPUT_GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY; delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  t.after(() => {
    if (previousKey !== undefined) process.env.GEMINI_API_KEY = previousKey; else delete process.env.GEMINI_API_KEY;
    if (previousInput !== undefined) process.env.INPUT_GEMINI_API_KEY = previousInput; else delete process.env.INPUT_GEMINI_API_KEY;
    if (previousGoogle !== undefined) process.env.GOOGLE_API_KEY = previousGoogle; else delete process.env.GOOGLE_API_KEY;
    if (previousGen !== undefined) process.env.GOOGLE_GENERATIVE_AI_API_KEY = previousGen; else delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  });
  const reasoned = await corpus(t, 'corpus-coord');
  const selected = await loadWalkingSkeletonSpec(path.join(root, 'specs'));
  const reasonedConfig = path.join(reasoned, 'isotope.yml');
  const plannerCalls = { n: 0 };
  const missing = await verifyWalkingSkeleton({
    configPath: reasonedConfig, selectedSpecs: selected, testFixtureDirectory: path.join(root, 'corpus/cases/fixtures/sub-updated-single'),
    disableReasoner: false, disableRepair: false, assumeCredentials: true,
    semanticModel: reasonerModel('incompatibility', 'incompatibility'),
  });
  assert.equal(missing.report.verdict.verdict, 'FAIL_REASONED'); assert.equal(missing.exitCode, 1); assert.equal(missing.report.verifiedRepairs.length, 0);
  assert.match(missing.output, /planner unavailable|credentials_unavailable|not attempted/);
  const mechanical = await corpus(t, 'mechanical-break');
  const mechConfig = path.join(mechanical, 'isotope.yml');
  const cfg = JSON.parse(await fs.readFile(mechConfig, 'utf8')); cfg.repair.mode = 'on'; cfg.repair.planner = 'model'; await fs.writeFile(mechConfig, JSON.stringify(cfg, null, 2));
  const det = await verifyWalkingSkeleton({
    configPath: mechConfig, selectedSpecs: selected, testFixtureDirectory: path.join(root, 'corpus/cases/fixtures/sub-updated-single'),
    disableReasoner: true, disableRepair: false, plannerModel: model([cassetteFile('repair-candidate')], plannerCalls),
  });
  assert.equal(det.report.verdict.verdict, 'FAIL'); assert.equal(det.exitCode, 5); assert.equal(plannerCalls.n, 0); assert.equal(det.report.verifiedRepairs[0].candidate.origin, 'deterministic');
});

test('held-out unique markers never appear in a serialized RepairPacket', { timeout: 120000 }, async t => {
  const repo = await corpus(t, 'corpus-coord');
  const selected = await loadWalkingSkeletonSpec(path.join(root, 'specs'));
  const config = JSON.parse(await fs.readFile(path.join(repo, 'isotope.yml'), 'utf8'));
  const spec = selected.specs[0];
  const bdg = await resolveBehavioralDependencyGraph({ repositoryRoot: repo, config, changeSpec: spec });
  const entry = bdg.entryPoints[0];
  const dir = path.join(root, 'corpus/cases/fixtures/sub-updated-single');
  const old = JSON.parse(await fs.readFile(path.join(dir, 'old.json'), 'utf8'));
  const next = JSON.parse(await fs.readFile(path.join(dir, 'new.json'), 'utf8'));
  const fixture = { id: 'synthetic-sub-updated-single', role: 'planning', oldPath: path.join(dir, 'old.json'), newPath: path.join(dir, 'new.json'), oldVersion: old.api_version, newVersion: next.api_version };
  const executed = await runHarness({ repoRoot: repo, config, entryPoint: entry, bdg, fixture, codeVersion: 'original' });
  const diff = diffSignatures({ old: executed.old[0], new: executed.new[0], bdg, selfComparisons: executed });
  const verdict = { entryPointId: entry.id, verdict: 'FAIL_REASONED', provenance: 'reasoned', reason: 'reasoned_incompatibility', divergenceIds: diff.divergences.map(d => d.id), reasoningRefs: [], evidenceRefs: [], suspectedInjection: false };
  const built = await repair.buildRepairPacket({
    repoRoot: repo, spec, bdg, entryPoint: entry, diff, verdict, old: executed.old[0], new: executed.new[0],
    oldPayload: old, newPayload: next, redact: false, maxFiles: 3, maxChangedLines: 80,
    heldOutForbidden: ['sub_HELDOUT_UNIQUE', '987654321', 'sub_heldout', '1701234567'],
  });
  assert.equal(built.ok, true, built.reason);
  const text = JSON.stringify(built.packet);
  assert.doesNotMatch(text, /sub_HELDOUT_UNIQUE/);
  assert.doesNotMatch(text, /987654321/);
  assert.doesNotMatch(text, /sub_heldout/);
});

test('live Gemini planner is optional and skipped without credentials', { timeout: 180000 }, async t => {
  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) { t.skip('GEMINI_API_KEY not available'); return; }
  const repo = await corpus(t, 'corpus-coord');
  const selected = await loadWalkingSkeletonSpec(path.join(root, 'specs'));
  const run = await verifyWalkingSkeleton({
    configPath: path.join(repo, 'isotope.yml'), selectedSpecs: selected,
    testFixtureDirectory: path.join(root, 'corpus/cases/fixtures/sub-updated-single'),
    disableReasoner: false, disableRepair: false, assumeCredentials: true,
    semanticModel: reasonerModel('incompatibility', 'incompatibility'),
  });
  assert.equal(run.report.verdict.verdict, 'FAIL_REASONED', run.output);
  assert.ok(run.report.candidateRefs.length || /planner/i.test(run.output));
});
