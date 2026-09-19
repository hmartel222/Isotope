const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const execute = promisify(execFile);
const core = require('@isotope/core');
const differ = require('@isotope/differ');
const harness = require('@isotope/harness-ts');
const { verifyWalkingSkeleton } = require('@isotope/cli');
const { loadWalkingSkeletonSpec } = require('@isotope/changespec');
const { fixtures, clone } = require('./fixtures/contracts.cjs');
const root = path.resolve(__dirname, '..');
const testFixtures = kind => path.join(root, 'packages/harness-ts/test-fixtures', kind);
const parseYaml = require('../packages/cli/node_modules/yaml').parse;

async function project(t) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'isotope-phase2-test-')));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const original = path.join(root, 'examples/walking-skeleton');
  await fs.cp(path.join(original, 'src'), path.join(directory, 'src'), { recursive: true });
  await fs.copyFile(path.join(original, 'isotope.yml'), path.join(directory, 'isotope.yml'));
  await fs.copyFile(path.join(original, 'bdg.stub.json'), path.join(directory, 'bdg.stub.json'));
  return directory;
}
async function configAt(directory) { return parseYaml(await fs.readFile(path.join(directory, 'isotope.yml'), 'utf8')); }
async function inputAt(directory, fixtureKind = 'broken') {
  return { repoRoot: directory, config: await configAt(directory), entryPoint: { id: 'ep_phase2', file: 'src/webhook.ts', export: 'handler', kind: 'express_route', language: 'ts' },
    bdg: JSON.parse(await fs.readFile(path.join(directory, 'bdg.stub.json'), 'utf8')), codeVersion: 'original',
    fixture: { id: 'synthetic-sub-updated-single', role: 'planning', oldPath: path.join(testFixtures(fixtureKind), 'old.json'), newPath: path.join(testFixtures(fixtureKind), 'new.json'), oldVersion: '2025-02-24.acacia', newVersion: '2026-08-26.dahlia' } };
}
async function singleAt(directory, exportName = 'handler') {
  return { entryFile: path.join(directory,'src/webhook.ts'), dbFile: path.join(directory,'src/db.ts'), exportName,
    fixture: JSON.parse(await fs.readFile(path.join(testFixtures('broken'),'old.json'),'utf8')),
    dbReturn: { id: 'fixed' }, entryPointId: 'ep_phase2', codeVersion: 'original', payloadVersion: 'old', fixturePair: 'synthetic', runIndex: 0 };
}
function diffInput(old = clone(fixtures.Signature), next = clone(old)) {
  return { old, new: next, bdg: fixtures.BDG, selfComparisons: { old: [clone(old), { ...clone(old), runIndex: 1, durationMs: 999 }], new: [clone(next), { ...clone(next), runIndex: 1, durationMs: 777 }] } };
}
function verdict(diff) { return core.resolveVerdict({ entryPoint: fixtures.EntryPoint, bdg: fixtures.BDG, diff, reasoning: null, config: fixtures.IsotopeConfig }); }

test('phase2 serializer preserves undefined, null, dates, array order, and stable keys', () => {
  assert.deepEqual(harness.serializeBehavior({ b: undefined, a: [2, undefined, null, 1], date: new Date('2020-01-01T00:00:00Z') }), { a: [2,'__undefined__',null,1], b: '__undefined__', date: '2020-01-01T00:00:00.000Z' });
  assert.equal(JSON.stringify(harness.serializeBehavior({ b: 2, a: { z: 3, x: 1 } })), JSON.stringify(harness.serializeBehavior({ a: { x: 1, z: 3 }, b: 2 })));
  assert.throws(() => harness.serializeBehavior(() => {}), /Unsupported/);
  const cycle = {}; cycle.self = cycle; assert.throws(() => harness.serializeBehavior(cycle), /Circular/);
});
test('behavioral view ignores every metadata field but observes DB args', () => {
  const a = clone(fixtures.Signature);
  const b = { ...clone(a), entryPointId: 'different', codeVersion: 'patched:r1', payloadVersion: 'different', fixturePair: 'other', runIndex: 9, durationMs: 4567 };
  assert.ok(differ.behaviorEqual(a,b));
  assert.deepEqual(Object.keys(differ.behavioralView(a)).sort(), ['calls','returned','threw']);
  b.calls[0].args[0].value = 999;
  assert.equal(differ.behaviorEqual(a,b), false);
});
test('identical observed behavior produces no divergences and a mechanical PASS', () => {
  const diff = differ.diffSignatures(diffInput());
  assert.deepEqual(diff.divergences, []); assert.equal(verdict(diff).verdict, 'PASS');
});
for (const value of ['__undefined__', null, 'DELETE']) test(`defined → ${value} is mechanical value_to_missing`, () => {
  const input = diffInput();
  if (value === 'DELETE') delete input.new.calls[0].args[0].value; else input.new.calls[0].args[0].value = value;
  input.selfComparisons.new = [clone(input.new), clone(input.new)];
  const diff = differ.diffSignatures(input);
  assert.equal(diff.divergences[0].pointer, '/calls/0/args/0/value');
  assert.equal(diff.divergences[0].kind, 'value_to_missing'); assert.equal(diff.divergences[0].severity, 'critical');
  assert.equal(diff.divergences[0].sinkKind, 'db_write'); assert.equal(verdict(diff).verdict, 'FAIL');
});
test('new-only throw is a high mechanical failure', () => {
  const a = clone(fixtures.Signature); const b = { ...clone(a), threw: { name: 'Error', message: 'new failure' } };
  const diff = differ.diffSignatures(diffInput(a,b));
  assert.equal(diff.divergences[0].kind, 'threw_new_only'); assert.equal(diff.divergences[0].severity, 'high'); assert.equal(verdict(diff).verdict, 'FAIL');
});
test('dropped calls are not hidden by index shifting', () => {
  const a = clone(fixtures.Signature); a.calls.push({ ...clone(a.calls[0]), seq: 1, mock: 'db.other' });
  const b = { ...clone(a), calls: [{ ...clone(a.calls[1]), seq: 0 }] };
  const diff = differ.diffSignatures(diffInput(a,b));
  assert.ok(diff.divergences.some(d => d.kind === 'call_dropped' && d.old.mock === 'db.record'));
  assert.equal(verdict(diff).verdict, 'FAIL');
});
test('nondeterministic self-comparison gates old/new failure classification', () => {
  const input = diffInput(); input.selfComparisons.old[1].calls[0].args[0].value = 888;
  input.new.calls = []; input.selfComparisons.new = [clone(input.new),clone(input.new)];
  const diff = differ.diffSignatures(input);
  assert.equal(diff.stable, false); assert.ok(diff.unstablePointers.includes('/calls/0/args/0/value'));
  assert.ok(diff.divergences.every(d => d.kind === 'unstable'));
  assert.equal(verdict(diff).verdict, 'INDETERMINATE'); assert.equal(verdict(diff).reason, 'nondeterministic_handler');
});
test('unsupported semantic differences never become arbitrary FAIL or PASS', () => {
  const a = clone(fixtures.Signature); const b = clone(a); b.calls[0].args[0].value = 43;
  const diff = differ.diffSignatures(diffInput(a,b));
  assert.equal(diff.divergences[0].tier, 'semantic_question');
  assert.equal(verdict(diff).verdict,'INDETERMINATE'); assert.match(verdict(diff).reason,/unsupported_semantic/);
});
test('JSON pointers escape property names and arrays remain positional', () => {
  const a = clone(fixtures.Signature); a.calls[0].args = [{ 'a/b~c': [1,2] }];
  const b = clone(a); b.calls[0].args[0]['a/b~c'] = [2,1];
  const diff = differ.diffSignatures(diffInput(a,b));
  assert.equal(diff.divergences.length,2); assert.equal(diff.divergences[0].pointer,'/calls/0/args/0/a~1b~0c/0');
});
test('the actual static Stripe spec and BDG validate', async () => {
  const selected = await loadWalkingSkeletonSpec(path.join(root,'specs'));
  assert.equal(selected.specs[0].verified_by, 'human'); assert.deepEqual(selected.dependencyChanges, []);
  core.validateContract('BDG', JSON.parse(await fs.readFile(path.join(root,'examples/walking-skeleton/bdg.stub.json'),'utf8')));
});

test('real handler execution captures four isolated signatures and immutable fixtures', async t => {
  const directory = await project(t); const input = await inputAt(directory);
  const before = await Promise.all([input.fixture.oldPath,input.fixture.newPath].map(f=>fs.readFile(f,'utf8')));
  const signatures = await harness.runHarness(input);
  for (const signature of [...signatures.old,...signatures.new]) {
    core.validateContract('Signature',signature); assert.deepEqual(signature.returned,{status:200,body:{received:true}});
    assert.equal(signature.threw,null); assert.equal(signature.calls[0].seq,0); assert.equal(signature.calls[0].mock,'db.subscription.update');
    assert.equal(signature.calls[0].sinkKind,'db_write');
  }
  assert.equal(signatures.old[0].calls[0].args[0].data.renewalDate, JSON.parse(before[0]).data.object.current_period_end);
  assert.equal(signatures.new[0].calls[0].args[0].data.renewalDate,'__undefined__');
  assert.ok(differ.checkDeterminism(signatures.old).stable); assert.ok(differ.checkDeterminism(signatures.new).stable);
  assert.deepEqual(signatures.old.map(s=>s.runIndex),[0,1]); assert.deepEqual(signatures.new.map(s=>s.runIndex),[0,1]);
  assert.deepEqual(await Promise.all([input.fixture.oldPath,input.fixture.newPath].map(f=>fs.readFile(f,'utf8'))),before);
});
test('fresh fixtures/modules and call-time snapshots survive customer mutation', async t => {
  const directory = await project(t);
  await fs.appendFile(path.join(directory,'src/webhook.ts'), `\nlet counter = 0;\nexport async function mutating(req, res) { const event = stripe.webhooks.constructEvent(req.body, '', ''); const sub = event.data.object; const args = { count: ++counter, value: sub.current_period_end }; await db.subscription.update(args); args.value = 99; sub.current_period_end = 88; return res.status(200).json({ count: counter }); }\n`);
  const plan = await singleAt(directory,'mutating');
  const original = structuredClone(plan.fixture);
  const first = await harness.runTsHarness(plan); const second = await harness.runTsHarness({...plan,runIndex:1});
  assert.ok(differ.behaviorEqual(first,second)); assert.equal(first.calls[0].args[0].count,1);
  assert.equal(first.calls[0].args[0].value,original.data.object.current_period_end);
  assert.deepEqual(plan.fixture,original);
});
test('handler errors after provider stub execution are captured as behavior', async t => {
  const directory = await project(t);
  await fs.appendFile(path.join(directory,'src/webhook.ts'), `\nexport async function throwing(req) { stripe.webhooks.constructEvent(req.body, '', ''); throw new Error('deliberate handler error'); }\n`);
  const sig = await harness.runTsHarness(await singleAt(directory,'throwing'));
  assert.deepEqual(sig.threw,{name:'Error',message:'deliberate handler error'}); assert.equal(sig.returned,'__undefined__');
});
for (const [name, source, reason] of [
  ['unsupportedValue', `stripe.webhooks.constructEvent(req.body, '', ''); await db.subscription.update({ value: () => 1 }); return res.status(200).json({received:true});`, 'unsupported_behavior_serialization'],
  ['missingStub', `return res.status(200).json({received:true});`, 'provider_stub_not_exercised'],
  ['signatureFailure', `stripe.webhooks.constructEvent(req.body, '', ''); const error = new Error('signature verification failed'); error.name = 'StripeSignatureVerificationError'; throw error;`, 'provider_stub_not_exercised'],
  ['blockedRequest', `stripe.webhooks.constructEvent(req.body, '', ''); try { await fetch('https://example.invalid'); } catch {} return res.status(200).json({received:true});`, 'blocked_egress'],
]) test(`harness rejects ${name} rather than allowing a false PASS`, async t => {
  const directory = await project(t);
  await fs.appendFile(path.join(directory,'src/webhook.ts'), `\nexport async function ${name}(req,res) { ${source} }\n`);
  await assert.rejects(harness.runTsHarness(await singleAt(directory,name)), e => e instanceof harness.HarnessExecutionError && e.reason === reason);
});
test('missing constructEvent becomes INDETERMINATE in the real orchestration', async t => {
  const directory = await project(t);
  await fs.writeFile(path.join(directory,'src/webhook.ts'), 'export async function handler(req,res) { return res.status(200).json({ received:true }); }');
  const result = await verifyWalkingSkeleton({configPath:path.join(directory,'isotope.yml'),testFixtureDirectory:testFixtures('broken')});
  assert.equal(result.exitCode,4); assert.equal(result.report.verdict.verdict,'INDETERMINATE'); assert.equal(result.report.verdict.results[0].reason,'provider_stub_not_exercised');
  assert.deepEqual(result.report.signatureRefs,[]); assert.deepEqual(result.report.diffReportRefs,[]);
});
test('multiple configured entry points fail with an actionable error', async t => {
  const directory = await project(t); const config = await configAt(directory); config.entryPoints.push({...config.entryPoints[0],export:'other'});
  await fs.writeFile(path.join(directory,'isotope.yml'),JSON.stringify(config));
  await assert.rejects(verifyWalkingSkeleton({configPath:path.join(directory,'isotope.yml'),testFixtureDirectory:testFixtures('broken')}),/exactly one/);
});
test('CLI broken case exits 1 and all nine generated artifacts validate; no later-stage artifacts', async t => {
  const directory = await project(t);
  let result;
  try { await execute(process.execPath,[path.join(root,'packages/cli/dist/bin.js'),'verify'], {cwd:directory,env:{...process.env,ISOTOPE_TEST_FIXTURES:testFixtures('broken')},timeout:60000}); assert.fail('Expected behavioral FAIL exit 1'); }
  catch (error) { assert.equal(error.code,1,error.stderr); result=error; }
  assert.match(result.stdout,/SYNTHETIC TEST-ONLY/); assert.match(result.stdout,/Both executions returned 200/); assert.match(result.stdout,/Verdict: FAIL/); assert.match(result.stdout,/old PASS; new PASS/);
  const p=core.artifactPaths(directory);
  const report=await core.readJsonArtifact(p.root,p.report,'IsotopeReport');
  assert.equal(report.signatureRefs.length,4); assert.deepEqual(report.audit,[]);
  for (const [file,contract] of [[p.selectedSpecs,'SelectedSpecs'],[p.bdg,'BDG'],[p.diffReport,'DiffReport'],[p.verdict,'VerdictReport'],[p.report,'IsotopeReport'],...report.signatureRefs.map(ref=>[path.join(p.root,ref),'Signature'])]) await core.readJsonArtifact(p.root,file,contract);
  const diff=await core.readJsonArtifact(p.root,p.diffReport,'DiffReport');
  assert.equal(diff.divergences[0].pointer,'/calls/0/args/0/data/renewalDate'); assert.equal(diff.divergences[0].new,'__undefined__');
  assert.equal(diff.divergences[0].old,JSON.parse(await fs.readFile(path.join(testFixtures('broken'),'old.json'),'utf8')).data.object.current_period_end);
  for(const dir of ['reasoning','repair','evidence-packets']) await assert.rejects(fs.access(path.join(p.root,dir)),{code:'ENOENT'});
});
test('CLI identical-behavior control exits 0 with PASS using the same execution pipeline', async t => {
  const directory=await project(t);
  const result=await execute(process.execPath,[path.join(root,'packages/cli/dist/bin.js'),'verify'],{cwd:directory,env:{...process.env,ISOTOPE_TEST_FIXTURES:testFixtures('control')},timeout:60000});
  assert.match(result.stdout,/Verdict: PASS/); assert.match(result.stdout,/old PASS; new PASS/);
  const p=core.artifactPaths(directory); const diff=await core.readJsonArtifact(p.root,p.diffReport,'DiffReport'); assert.deepEqual(diff.divergences,[]);
});

test('added call arguments remain unsupported semantic differences, never a false PASS', () => {
  const a = clone(fixtures.Signature); const b = clone(a); b.calls[0].args.push({ extra: true });
  const diff = differ.diffSignatures(diffInput(a,b)); assert.equal(verdict(diff).verdict,'INDETERMINATE');
});
test('failed re-run removes stale comparison artifacts', async t => {
  const directory = await project(t); const p = core.artifactPaths(directory);
  await fs.mkdir(p.root); await fs.writeFile(p.diffReport, JSON.stringify(fixtures.DiffReport));
  await fs.writeFile(path.join(directory,'src/webhook.ts'), 'export async function handler(req,res) { return res.status(200).json({ received:true }); }');
  const result=await verifyWalkingSkeleton({configPath:path.join(directory,'isotope.yml'),testFixtureDirectory:testFixtures('broken')});
  assert.equal(result.exitCode,4); await assert.rejects(fs.access(p.diffReport), {code:'ENOENT'});
});

test('extra ChangeSpecs fail explicitly instead of silently selecting one', async t => {
  const directory = await project(t);
  const specs = path.join(directory,'specs'); await fs.cp(path.join(root,'specs'),specs,{recursive:true});
  await fs.writeFile(path.join(specs,'unexpected.yaml'),'id: other');
  await assert.rejects(loadWalkingSkeletonSpec(specs),/exactly one known ChangeSpec/);
});
