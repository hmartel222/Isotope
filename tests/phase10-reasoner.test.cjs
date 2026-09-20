const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { fixtures, clone } = require('./fixtures/contracts.cjs');
const core = require('@isotope/core');
const reasoner = require('@isotope/reasoner');
const reporter = require('@isotope/reporter');
const { loadWalkingSkeletonSpec } = require('@isotope/changespec');
const { verifyWalkingSkeleton } = require('@isotope/cli');

const root = path.resolve(__dirname, '..');
const cassetteFile = name => JSON.parse(require('fs').readFileSync(path.join(root, 'tests/cassettes/reasoner', `${name}.json`), 'utf8'));
const cassette = name => { const raw = cassetteFile(name); return raw.voteA ?? raw; };

test('uses the stable Gemini 3.6 Flash model by default', () => {
  assert.equal(reasoner.DEFAULT_REASONER_MODEL, 'gemini-3.6-flash');
});

function bindVote(vote, user) {
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
  return { modelId: 'cassette-test', classify: async (input) => {
    calls.n += 1;
    const vote = votes[Math.min(i, votes.length - 1)];
    i += 1;
    if (vote === 'THROW') throw new Error('api down');
    if (vote === 'TIMEOUT') { await new Promise(r => setTimeout(r, 40)); throw new Error('timeout'); }
    if (typeof vote === 'string') return vote;
    return JSON.stringify(bindVote(vote, input.user));
  } };
}

function semanticDiff() {
  const diff = clone(fixtures.DiffReport);
  diff.divergences[0] = { ...diff.divergences[0], kind: 'value_changed', tier: 'semantic_question', severity: null, old: 42, new: 99, pointer: '/calls/0/args/0/data/renewalDate' };
  return diff;
}

test('eligibility is a pure gate and never invokes a model for mechanical failures', () => {
  const calls = { n: 0 }; const semanticModel = model([cassette('benign-adaptation'), cassette('benign-adaptation')], calls);
  const mechanical = clone(fixtures.DiffReport);
  const ineligible = reasoner.evaluateReasoningEligibility({
    diff: mechanical, bdg: fixtures.BDG, entryPoint: fixtures.EntryPoint, config: { ...fixtures.IsotopeConfig, reasoner: { mode: 'on', maxInvocations: 10, redact: false } },
    credentialsAvailable: true, remainingInvocations: 10,
  });
  assert.equal(ineligible.eligible, false); assert.equal(ineligible.reason, 'mechanical_failure');
  const mixed = clone(mechanical); mixed.divergences.push({ ...mixed.divergences[0], id: 'd2', kind: 'value_changed', tier: 'semantic_question', severity: null, old: 1, new: 2 });
  assert.equal(reasoner.evaluateReasoningEligibility({ diff: mixed, bdg: fixtures.BDG, entryPoint: fixtures.EntryPoint, config: { ...fixtures.IsotopeConfig, reasoner: { mode: 'on', maxInvocations: 10, redact: false } }, credentialsAvailable: true, remainingInvocations: 10 }).reason, 'mechanical_failure');
  void semanticModel; assert.equal(calls.n, 0);
  const residual = semanticDiff();
  assert.equal(reasoner.evaluateReasoningEligibility({ diff: residual, bdg: fixtures.BDG, entryPoint: fixtures.EntryPoint, config: fixtures.IsotopeConfig, credentialsAvailable: true, remainingInvocations: 10 }).reason, 'reasoner_disabled');
  const on = { ...fixtures.IsotopeConfig, reasoner: { mode: 'on', maxInvocations: 10, redact: false } };
  assert.equal(reasoner.evaluateReasoningEligibility({ diff: residual, bdg: fixtures.BDG, entryPoint: fixtures.EntryPoint, config: on, credentialsAvailable: false, remainingInvocations: 10 }).reason, 'credentials_unavailable');
  assert.equal(reasoner.evaluateReasoningEligibility({ diff: residual, bdg: fixtures.BDG, entryPoint: fixtures.EntryPoint, config: on, credentialsAvailable: true, remainingInvocations: 1 }).reason, 'invocation_cap_exceeded');
  const low = clone(fixtures.BDG); low.affectedSites[0].provenance.confidence = 'low';
  assert.equal(reasoner.evaluateReasoningEligibility({ diff: residual, bdg: low, entryPoint: fixtures.EntryPoint, config: on, credentialsAvailable: true, remainingInvocations: 10 }).reason, 'low_confidence_site');
  const logOnly = semanticDiff(); logOnly.divergences[0].sinkKind = 'log_only';
  assert.equal(reasoner.evaluateReasoningEligibility({ diff: logOnly, bdg: fixtures.BDG, entryPoint: fixtures.EntryPoint, config: on, credentialsAvailable: true, remainingInvocations: 10 }).reason, 'log_only_only');
});

test('cassette consensus maps onto reasoned verdicts and conservative escalations', () => {
  const diff = semanticDiff();
  const config = { ...fixtures.IsotopeConfig, reasoner: { mode: 'on', maxInvocations: 10, redact: false } };
  const run = (a, b, status = 'completed') => ({ status, results: [a, b], packetRef: 'p', responseRefs: ['a', 'b'] });
  const verdictFor = (reasoning) => core.resolveVerdict({ entryPoint: fixtures.EntryPoint, bdg: fixtures.BDG, diff, reasoning, config });
  assert.equal(verdictFor(run(cassette('benign-adaptation'), cassette('benign-adaptation'))).verdict, 'PASS_REASONED');
  assert.equal(verdictFor(run(cassette('incompatibility'), cassette('incompatibility'))).verdict, 'FAIL_REASONED');
  assert.equal(verdictFor(run(cassette('human-decision'), cassette('human-decision'))).verdict, 'ESCALATE');
  assert.equal(verdictFor(run(cassette('benign-adaptation'), cassette('incompatibility'), 'disagreed')).verdict, 'ESCALATE');
  assert.equal(verdictFor(run(cassette('low-confidence'), cassette('low-confidence'), 'abstained')).verdict, 'ESCALATE');
  assert.equal(verdictFor(run(cassette('abstain'), cassette('abstain'), 'abstained')).verdict, 'ESCALATE');
  const injected = verdictFor(run(cassette('injection'), cassette('injection'), 'errored'));
  assert.equal(injected.verdict, 'ESCALATE'); assert.equal(injected.suspectedInjection, true);
  assert.equal(verdictFor({ status: 'errored', results: [], packetRef: 'p', responseRefs: [], error: 'suspected_prompt_injection' }).verdict, 'ESCALATE');
  assert.equal(verdictFor({ status: 'unavailable', results: [], packetRef: 'p', responseRefs: [], error: 'reasoner_timeout' }).verdict, 'ESCALATE');
  assert.equal(verdictFor({ status: 'errored', results: [], packetRef: 'p', responseRefs: [], error: 'malformed' }).verdict, 'ESCALATE');
  assert.equal(verdictFor(run(cassette('abstain'), cassette('abstain'), 'completed')).verdict, 'ESCALATE');
  assert.equal(verdictFor(run(cassette('low-confidence'), cassette('low-confidence'), 'completed')).verdict, 'ESCALATE');
  assert.equal(verdictFor(run(cassette('benign-adaptation'), cassette('incompatibility'), 'completed')).verdict, 'ESCALATE');
  assert.equal(verdictFor(null).verdict, 'ESCALATE');
  assert.equal(core.resolveVerdict({ entryPoint: fixtures.EntryPoint, bdg: fixtures.BDG, diff, reasoning: run(cassette('benign-adaptation'), cassette('benign-adaptation')), config: fixtures.IsotopeConfig }).verdict, 'ESCALATE');
});

test('PR-level verdict precedence keeps mechanical FAIL above reasoned states', () => {
  const r = (verdict) => ({ ...fixtures.VerdictResult, verdict });
  assert.equal(core.resolveAggregateVerdict([r('PASS_REASONED'), r('FAIL')]).verdict, 'FAIL');
  assert.equal(core.resolveAggregateVerdict([r('ESCALATE'), r('FAIL_REASONED')]).verdict, 'FAIL_REASONED');
  assert.equal(core.resolveAggregateVerdict([r('PASS'), r('PASS_REASONED')]).verdict, 'PASS_REASONED');
  assert.equal(core.resolveAggregateVerdict([r('SKIP'), r('INDETERMINATE')]).verdict, 'INDETERMINATE');
  assert.deepEqual(core.VERDICT_PRECEDENCE, ['FAIL', 'FAIL_REASONED', 'ESCALATE', 'INDETERMINATE', 'PASS_REASONED', 'PASS', 'SKIP']);
});

test('mechanical FAIL still bypasses supplied reasoning accessors', () => {
  const diff = clone(fixtures.DiffReport);
  const opaque = { get reasoning() { throw new Error('reasoning must not be read'); }, get config() { throw new Error('config cannot override mechanical authority'); } };
  const input = { entryPoint: fixtures.EntryPoint, diff }; Object.defineProperties(input, Object.getOwnPropertyDescriptors(opaque));
  assert.equal(core.resolveVerdict(input).verdict, 'FAIL');
});

test('reporter distinguishes reasoned pass/fail from mechanical states', () => {
  const pass = { report: { ...clone(fixtures.IsotopeReport), verdict: { schemaVersion: 1, verdict: 'PASS_REASONED', results: [{ ...fixtures.VerdictResult, verdict: 'PASS_REASONED' }] } }, selected: fixtures.SelectedSpecs, bdg: fixtures.BDG, diffs: [semanticDiff()], signatures: [fixtures.Signature], reasoning: [cassette('benign-adaptation')] };
  const text = reporter.renderPrComment(pass);
  assert.match(text, /reasoned benign adaptation/); assert.match(text, /Disabling the reasoner/); assert.equal(reporter.mapVerdictToConclusion('PASS_REASONED'), 'success');
  const fail = { ...pass, report: { ...pass.report, verdict: { schemaVersion: 1, verdict: 'FAIL_REASONED', results: [{ ...fixtures.VerdictResult, verdict: 'FAIL_REASONED' }] } }, reasoning: [cassette('incompatibility')] };
  assert.match(reporter.renderPrComment(fail), /semantic incompatibility/); assert.equal(reporter.mapVerdictToConclusion('FAIL_REASONED'), 'failure');
});

async function corpus(t, name) {
  const repo = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), `isotope-phase10-${name}-`)));
  t.after(() => fs.rm(repo, { recursive: true, force: true }));
  await fs.cp(path.join(root, 'corpus/cases/repositories', name), repo, { recursive: true });
  return repo;
}

function cassetteModel(nameA, nameB, calls = { n: 0 }) { return model([cassette(nameA), cassette(nameB)], calls); }

test('aggregation cassette produces PASS_REASONED; reasoner off stays ESCALATE', { timeout: 120000 }, async t => {
  const repo = await corpus(t, 'ambiguity-escalate');
  const selected = await loadWalkingSkeletonSpec(path.join(root, 'specs'), 'stripe.basil.subscription-period');
  const configPath = path.join(repo, 'isotope.yml');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8')); config.reasoner.mode = 'on'; await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  const calls = { n: 0 };
  const on = await verifyWalkingSkeleton({ configPath, selectedSpecs: selected, testFixtureDirectory: path.join(root, 'corpus/cases/fixtures/sub-updated-multi'), disableReasoner: false, disableRepair: true, semanticModel: cassetteModel('benign-adaptation', 'benign-adaptation', calls), assumeCredentials: true });
  assert.equal(on.report.verdict.verdict, 'PASS_REASONED', on.output); assert.equal(on.exitCode, 0); assert.equal(calls.n, 2);
  assert.ok(on.report.evidencePacketRefs.length); assert.equal(on.report.reasoningRefs.length, 2);
  const off = await verifyWalkingSkeleton({ configPath, selectedSpecs: selected, testFixtureDirectory: path.join(root, 'corpus/cases/fixtures/sub-updated-multi'), disableReasoner: true, disableRepair: true, semanticModel: cassetteModel('benign-adaptation', 'benign-adaptation'), assumeCredentials: true });
  assert.equal(off.report.verdict.verdict, 'ESCALATE'); assert.equal(off.exitCode, 3);
});

test('first-item semantic incompatibility cassette produces FAIL_REASONED and does not repair', { timeout: 120000 }, async t => {
  const repo = await corpus(t, 'semantic-incompat');
  const selected = await loadWalkingSkeletonSpec(path.join(root, 'specs'), 'stripe.basil.subscription-period');
  const configPath = path.join(repo, 'isotope.yml');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8')); config.reasoner.mode = 'on'; config.repair.mode = 'on'; await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  const run = await verifyWalkingSkeleton({ configPath, selectedSpecs: selected, testFixtureDirectory: path.join(root, 'corpus/cases/fixtures/sub-updated-multi'), disableReasoner: false, disableRepair: false, semanticModel: cassetteModel('incompatibility', 'incompatibility'), assumeCredentials: true });
  assert.equal(run.report.verdict.verdict, 'FAIL_REASONED', run.output); assert.equal(run.exitCode, 1); assert.equal(run.report.verifiedRepairs.length, 0);
});

test('human-decision cassette escalates with the ChangeSpec question', { timeout: 120000 }, async t => {
  const repo = await corpus(t, 'human-policy');
  const selected = await loadWalkingSkeletonSpec(path.join(root, 'specs'), 'stripe.basil.subscription-period');
  const configPath = path.join(repo, 'isotope.yml');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8')); config.reasoner.mode = 'on'; await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  const run = await verifyWalkingSkeleton({ configPath, selectedSpecs: selected, testFixtureDirectory: path.join(root, 'corpus/cases/fixtures/sub-updated-multi'), disableReasoner: false, disableRepair: true, semanticModel: cassetteModel('human-decision', 'human-decision'), assumeCredentials: true });
  assert.equal(run.report.verdict.verdict, 'ESCALATE'); assert.match(run.output, /human_decision_required|Semantic reasoner/);
});

test('classification disagreement cassette escalates', { timeout: 120000 }, async t => {
  const repo = await corpus(t, 'ambiguity-escalate');
  const selected = await loadWalkingSkeletonSpec(path.join(root, 'specs'), 'stripe.basil.subscription-period');
  const configPath = path.join(repo, 'isotope.yml');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8')); config.reasoner.mode = 'on'; await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  const disagree = cassetteFile('disagreement');
  const run = await verifyWalkingSkeleton({
    configPath, selectedSpecs: selected, testFixtureDirectory: path.join(root, 'corpus/cases/fixtures/sub-updated-multi'),
    disableReasoner: false, disableRepair: true, assumeCredentials: true,
    semanticModel: model([disagree.voteA, disagree.voteB]),
  });
  assert.equal(run.report.verdict.verdict, 'ESCALATE');
});

test('mechanical FAIL never calls the reasoner even when a model is injected', { timeout: 120000 }, async t => {
  const repo = await corpus(t, 'mechanical-break');
  const selected = await loadWalkingSkeletonSpec(path.join(root, 'specs'), 'stripe.basil.subscription-period');
  const configPath = path.join(repo, 'isotope.yml');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8')); config.reasoner.mode = 'on'; await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  const calls = { n: 0 };
  const run = await verifyWalkingSkeleton({ configPath, selectedSpecs: selected, testFixtureDirectory: path.join(root, 'corpus/cases/fixtures/sub-updated-single'), disableReasoner: false, disableRepair: true, semanticModel: cassetteModel('benign-adaptation', 'benign-adaptation', calls), assumeCredentials: true });
  assert.equal(run.report.verdict.verdict, 'FAIL'); assert.equal(run.exitCode, 1); assert.equal(calls.n, 0); assert.equal(run.report.evidencePacketRefs.length, 0);
});

test('safe degradation never produces PASS_REASONED', () => {
  const a = { status: 'ok', result: cassette('benign-adaptation') };
  assert.equal(reasoner.resolveReasonerConsensus({ status: 'unavailable', error: 'no key' }, a).status, 'unavailable');
  assert.equal(reasoner.resolveReasonerConsensus({ status: 'timeout', error: 'timeout' }, a).status, 'unavailable');
  assert.equal(reasoner.resolveReasonerConsensus({ status: 'ok', result: cassette('benign-adaptation') }, { status: 'ok', result: cassette('incompatibility') }).status, 'disagreed');
  assert.equal(reasoner.resolveReasonerConsensus({ status: 'ok', result: cassette('low-confidence') }, { status: 'ok', result: cassette('low-confidence') }).status, 'abstained');
  assert.equal(reasoner.resolveReasonerConsensus({ status: 'ok', result: cassette('injection') }, { status: 'ok', result: cassette('injection') }).reason, 'suspected_prompt_injection');
});

test('schema retry is bounded to one extra API attempt', { timeout: 120000 }, async t => {
  const repo = await corpus(t, 'ambiguity-escalate');
  const selected = await loadWalkingSkeletonSpec(path.join(root, 'specs'), 'stripe.basil.subscription-period');
  const configPath = path.join(repo, 'isotope.yml');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8')); config.reasoner.mode = 'on'; await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  const calls = { n: 0 };
  const run = await verifyWalkingSkeleton({
    configPath, selectedSpecs: selected, testFixtureDirectory: path.join(root, 'corpus/cases/fixtures/sub-updated-multi'),
    disableReasoner: false, disableRepair: true, assumeCredentials: true,
    semanticModel: model(['not-json', cassette('benign-adaptation'), cassette('benign-adaptation')], calls),
  });
  assert.equal(run.report.verdict.verdict, 'PASS_REASONED', run.output);
  assert.equal(calls.n, 3);
});

test('required cassette classes never silently PASS_REASONED', () => {
  const a = { status: 'ok', result: cassette('benign-adaptation') };
  const disagree = cassetteFile('disagreement');
  assert.equal(reasoner.resolveReasonerConsensus({ status: 'ok', result: disagree.voteA }, { status: 'ok', result: disagree.voteB }).status, 'disagreed');
  assert.equal(reasoner.resolveReasonerConsensus({ status: 'invalid', error: 'malformed_json' }, a).status, 'errored');
  assert.equal(reasoner.resolveReasonerConsensus({ status: 'unavailable', error: 'api down' }, { status: 'unavailable', error: 'api down' }).status, 'unavailable');
});

test('timeout, missing credentials, and invocation cap escalate without PASS_REASONED', { timeout: 120000 }, async t => {
  const repo = await corpus(t, 'ambiguity-escalate');
  const selected = await loadWalkingSkeletonSpec(path.join(root, 'specs'), 'stripe.basil.subscription-period');
  const configPath = path.join(repo, 'isotope.yml');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8')); config.reasoner.mode = 'on'; await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  const timeoutCalls = { n: 0 };
  const timed = await verifyWalkingSkeleton({
    configPath, selectedSpecs: selected, testFixtureDirectory: path.join(root, 'corpus/cases/fixtures/sub-updated-multi'),
    disableReasoner: false, disableRepair: true, assumeCredentials: true,
    semanticModel: model(['TIMEOUT', cassette('benign-adaptation')], timeoutCalls),
  });
  assert.equal(timed.report.verdict.verdict, 'ESCALATE'); assert.notEqual(timed.report.verdict.verdict, 'PASS_REASONED');
  const noKey = await verifyWalkingSkeleton({
    configPath, selectedSpecs: selected, testFixtureDirectory: path.join(root, 'corpus/cases/fixtures/sub-updated-multi'),
    disableReasoner: false, disableRepair: true, assumeCredentials: false,
  });
  assert.equal(noKey.report.verdict.verdict, 'ESCALATE');
  config.reasoner.maxInvocations = 0; await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  const cappedCalls = { n: 0 };
  const capped = await verifyWalkingSkeleton({
    configPath, selectedSpecs: selected, testFixtureDirectory: path.join(root, 'corpus/cases/fixtures/sub-updated-multi'),
    disableReasoner: false, disableRepair: true, assumeCredentials: true,
    semanticModel: cassetteModel('benign-adaptation', 'benign-adaptation', cappedCalls),
  });
  assert.equal(capped.report.verdict.verdict, 'ESCALATE'); assert.equal(cappedCalls.n, 0);
});

test('redaction preserves control structure and provider field names', () => {
  const source = 'if (kind === "internal-note") { write("secret-token"); write("current_period_end"); }';
  const result = reasoner.redactSource(source, new Set(['current_period_end']));
  assert.equal(result.destroyedDecisionEvidence, false);
  assert.match(result.text, /internal-note/);
  assert.match(result.text, /current_period_end/);
  assert.match(result.text, /<redacted>/);
});

test('incomplete reasoned votes escalate', () => {
  const diff = semanticDiff();
  const config = { ...fixtures.IsotopeConfig, reasoner: { mode: 'on', maxInvocations: 10, redact: false } };
  const verdict = core.resolveVerdict({
    entryPoint: fixtures.EntryPoint, bdg: fixtures.BDG, diff, config,
    reasoning: { status: 'completed', results: [cassette('benign-adaptation')], packetRef: 'p', responseRefs: ['a'] },
  });
  assert.equal(verdict.verdict, 'ESCALATE');
});

test('live Gemini aggregation is optional and skipped without credentials', { timeout: 180000 }, async t => {
  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) { t.skip('GEMINI_API_KEY not available'); return; }
  const repo = await corpus(t, 'ambiguity-escalate');
  const selected = await loadWalkingSkeletonSpec(path.join(root, 'specs'), 'stripe.basil.subscription-period');
  const configPath = path.join(repo, 'isotope.yml');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8')); config.reasoner.mode = 'on'; await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  const run = await verifyWalkingSkeleton({ configPath, selectedSpecs: selected, testFixtureDirectory: path.join(root, 'corpus/cases/fixtures/sub-updated-multi'), disableReasoner: false, disableRepair: true, assumeCredentials: true });
  assert.equal(run.report.verdict.verdict, 'PASS_REASONED', run.output);
});
