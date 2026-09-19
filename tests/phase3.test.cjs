const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { once } = require('node:events');
const harness = require('@isotope/harness-ts');
const { behaviorEqual, checkDeterminism } = require('@isotope/differ');
const root = path.resolve(__dirname, '..');
async function setup(t, name = 'entropy') {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'isotope-phase3-')));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.cp(path.join(root, 'packages/harness-ts/test-projects'), directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'fixture.json'), JSON.stringify({ value: 12 }));
  return { repositoryRoot: directory, entryPoint: { id: 'ep-test', file: 'src/handlers.ts', exportName: name, kind: 'plain' },
    fixture: { pairId: 'synthetic-harness', side: 'old', payloadVersion: 'v1', payloadPath: 'fixture.json' },
    codeVersion: 'original', mocks: [
      { module: 'src/db', exports: { db: 'recordAll' }, sinkKind: 'db_write' },
      { module: '@isotope-test/mail', exports: { send: 'recordAll' }, sinkKind: 'email' },
      { module: '@isotope-test/queue', exports: { default: 'recordAll' }, sinkKind: 'queue' },
    ], mockReturns: { 'db.invoice.upsert': { id: 'fixed' } }, provider: { requireWebhookInterception: false }, runIndex: 0 };
}
async function clean(plan) { assert.deepEqual(await fs.readdir(path.join(plan.repositoryRoot, '.isotope/generated')), []); }
const reason = name => error => error instanceof harness.HarnessExecutionError && error.reason === name;

test('serializer covers v3 sentinels, hash, nonmutation, key ordering and bounds', () => {
  const cycle = { value: 1 }; cycle.self = cycle;
  const value = { undefined: undefined, nan: NaN, positive: Infinity, negative: -Infinity, fn() {}, cycle,
    buffer: Buffer.from('hello'), date: new Date('2026-01-01Z'), bigint: 123n };
  const result = harness.serializeBehavior(value);
  assert.equal(result.undefined, '__undefined__'); assert.equal(result.fn, '__fn__');
  assert.equal(result.cycle.self, '__circular__'); assert.equal(result.nan, '__NaN__');
  assert.equal(result.positive, '__Infinity__'); assert.equal(result.negative, '__-Infinity__');
  assert.equal(result.bigint, '__bigint__:123'); assert.equal(result.date, '2026-01-01T00:00:00.000Z');
  assert.deepEqual(result.buffer, { __buffer__: createHash('sha256').update('hello').digest('hex') });
  assert.equal(cycle.self, cycle); assert.equal(value.buffer.toString(), 'hello');
  let deep = {}; for (let i = 0; i < 30; i++) deep = { next: deep };
  const limits = []; assert.match(JSON.stringify(harness.serializeBehavior(deep, l => limits.push(l))), /__depth_limit__/);
  assert.ok(limits.includes('depth'));
  const array = Array.from({length: 600}, (_, i) => i);
  const bounded = harness.serializeBehavior(array); assert.equal(bounded.length, 501); assert.equal(bounded[499], 499); assert.equal(bounded[500], '__breadth_limit__');
  const object = Object.fromEntries(array.map(i => [String(i).padStart(3,'0'), i]));
  assert.equal(Object.keys(harness.serializeBehavior(object)).length,501);
  assert.equal(harness.serializeBehavior(object)['__breadth_limit__'],'__breadth_limit__');
  for (let n = 1; n < 50; n++) {
    const entries = Array.from({length:n}, (_,i)=>['key'+i, { z: i, a: [i, undefined] }]);
    assert.equal(JSON.stringify(harness.serializeBehavior(Object.fromEntries(entries))), JSON.stringify(harness.serializeBehavior(Object.fromEntries(entries.reverse()))));
  }
  assert.notDeepEqual(harness.serializeBehavior([1,2]), harness.serializeBehavior([2,1]));
  const shared = {a:1}; assert.deepEqual(harness.serializeBehavior([shared, shared]), [{a:1},{a:1}]);
  assert.throws(() => harness.serializeBehavior({ get value() { throw new Error('must not execute'); } }), /Accessor/);
});
test('nested recorder observes calls only, never becomes a thenable, clones configured returns', async () => {
  const calls = []; const returns = { 'db.user.create': { id: 1 } };
  const db = harness.createRecorder('db', 'db_write', calls, returns, harness.serializeBehavior);
  assert.equal(calls.length,0); const ignored = db.any.deep; assert.equal(calls.length,0);
  assert.equal(await db, db); assert.equal(db.then,undefined);
  const result = await db.user.create({ missing: undefined }); result.id=9;
  assert.deepEqual(await db.user.create(), {id:1}); assert.equal(db.noReturn(),undefined);
  assert.deepEqual(calls.map(c=>c.seq),[0,1,2]); assert.equal(calls[0].args[0].missing,'__undefined__');
});
test('actual noisy handler stabilizes Date/random/UUID across four fresh runs, without parent/env leakage', async t => {
  const plan = await setup(t); const originalRandom = Math.random; const before = Date.now();
  process.env.ISOTOPE_SECRET_TEST = 'do-not-forward'; t.after(()=>delete process.env.ISOTOPE_SECRET_TEST);
  const signatures = [];
  for (const side of ['old','new']) for (const runIndex of [0,1]) signatures.push(await harness.runTsHarness({...plan, runIndex, fixture: {...plan.fixture, side, payloadVersion:side}}));
  for (const signature of signatures) {
    assert.ok(behaviorEqual(signatures[0],signature)); const out=signature.returned;
    assert.equal(out.now,1767225600000); assert.equal(out.date,'2026-01-01T00:00:00.000Z'); assert.equal(out.random,0.42);
    for (const key of ['uuid','named','unprefixed','web']) assert.equal(out[key],'00000000-0000-4000-8000-000000000000');
    assert.equal(out.count,1); assert.equal(out.env,'__undefined__');
  }
  assert.equal(Math.random, originalRandom); assert.ok(Date.now()>=before); await clean(plan);
});
test('uncontrolled high-resolution entropy is detected by real isolated executions', async t => {
  const plan = await setup(t,'highResolutionEntropy');
  const first = await harness.runTsHarness(plan);
  const second = await harness.runTsHarness({...plan,runIndex:1});
  const determinism = checkDeterminism([first,second]);
  assert.equal(determinism.stable,false);
  assert.deepEqual(determinism.unstablePointers,['/returned']);
  await clean(plan);
});
test('concurrent executions keep modules, identities, calls and generated wrappers isolated', async t => {
  const plan = await setup(t,'mutation');
  const signatures = await Promise.all(Array.from({length:8},(_,runIndex)=>harness.runTsHarness({...plan,runIndex})));
  assert.deepEqual(signatures.map(signature=>signature.runIndex),[0,1,2,3,4,5,6,7]);
  for (const signature of signatures) {
    assert.ok(behaviorEqual(signatures[0],signature));
    assert.deepEqual(signature.returned,{count:1,value:77});
    assert.deepEqual(signature.calls,[{seq:0,mock:'db.user.create',sinkKind:'db_write',args:[{before:12,count:1}]}]);
  }
  await clean(plan);
});
test('fresh module/fixture/mocks, immutable files and call-time snapshots', async t => {
  const plan = await setup(t,'mutation'); const fixtureBefore = await fs.readFile(path.join(plan.repositoryRoot,'fixture.json'),'utf8');
  const sourceBefore = await fs.readFile(path.join(plan.repositoryRoot,'src/handlers.ts'),'utf8');
  const first = await harness.runTsHarness(plan); const second = await harness.runTsHarness({...plan,runIndex:1});
  assert.ok(behaviorEqual(first,second)); assert.equal(first.calls[0].seq,0); assert.deepEqual(first.calls[0].args,[{before:12,count:1}]);
  assert.equal(await fs.readFile(path.join(plan.repositoryRoot,'fixture.json'),'utf8'),fixtureBefore);
  assert.equal(await fs.readFile(path.join(plan.repositoryRoot,'src/handlers.ts'),'utf8'),sourceBefore); await clean(plan);
});
test('configured nested boundaries preserve global DB/email/queue order and deterministic returns', async t => {
  const plan = await setup(t,'effects'); const sig = await harness.runTsHarness(plan);
  assert.deepEqual(sig.calls.map(c=>[c.seq,c.mock,c.sinkKind]),[[0,'db.invoice.upsert','db_write'],[1,'send','email'],[2,'default.publish','queue'],[3,'db.invoice.upsert','db_write'],[4,'db.other','db_write']]);
  assert.deepEqual(sig.returned,{absent:'__undefined__',fresh:{id:'fixed'},then:'__undefined__'});
  assert.deepEqual(sig.calls[2].args,[['b','a']]); assert.equal(sig.calls[0].args[0].missing,'__undefined__');
});
test('real call-boundary serialization supports functions, cycles and Buffer', async t => {
  const sig = await harness.runTsHarness(await setup(t,'special'));
  assert.equal(sig.calls[0].args[0].cycle.self,'__circular__'); assert.equal(sig.calls[0].args[0].fn,'__fn__');
  assert.deepEqual(sig.calls[0].args[0].buffer,{__buffer__:createHash('sha256').update('hello').digest('hex')});
});
test('truncation cannot produce a normal signature', async t => {
  const plan = await setup(t,'tooLarge'); await assert.rejects(harness.runTsHarness(plan),reason('serialization_limit')); await clean(plan);
});
test('oversized string evidence fails closed instead of producing a truncated signature', async t => {
  const plan = await setup(t,'tooLong'); await assert.rejects(harness.runTsHarness(plan),reason('serialization_limit')); await clean(plan);
});
test('Express status/json/send/end, actual Stripe interception and deterministic retrieve', async t => {
  const plan = await setup(t); plan.entryPoint.file='src/express.ts'; plan.entryPoint.kind='express_route';
  plan.provider.requireWebhookInterception=true; plan.mocks.push({module:'stripe',strategy:'provider'});
  plan.mockReturns['stripe.subscriptions.retrieve']={id:'sub_test'};
  for (const [exportName, expected] of [['handler',{status:201,body:'done'}],['json',{status:202,body:{value:1}}],['send',{status:203,body:'sent'}],['retrieve',{status:200,body:{id:'sub_test'}}]]) {
    const sig=await harness.runTsHarness({...plan,entryPoint:{...plan.entryPoint,exportName}}); assert.deepEqual(sig.returned,expected);
    if(exportName==='handler') assert.deepEqual(sig.calls[0].args,[{value:12}]);
    if(exportName==='retrieve') assert.equal(sig.calls[0].sinkKind,'http_out');
  }
  await assert.rejects(harness.runTsHarness({...plan,entryPoint:{...plan.entryPoint,exportName:'missing'}}),reason('provider_stub_not_exercised'));
  await clean(plan);
});
test('local mock resolution is root-relative at two entry directory depths; patched output uses same semantics', async t => {
  const plan=await setup(t,'mutation'); await harness.runTsHarness(plan);
  const sig=await harness.runTsHarness({...plan,codeVersion:'patched:test-repair',entryPoint:{...plan.entryPoint,file:'src/deep/handler.ts',exportName:'handler'},outputPath:'.isotope/repair/test/signature.json'});
  assert.equal(sig.codeVersion,'patched:test-repair'); assert.equal(sig.calls[0].mock,'db.user.create');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(plan.repositoryRoot,'.isotope/repair/test/signature.json'),'utf8')),sig);
});
test('entry/mock traversal and symlink escapes rejected; unsupported adapters are explicit', async t => {
  const plan=await setup(t);
  await assert.rejects(harness.runTsHarness({...plan,entryPoint:{...plan.entryPoint,file:'../../etc/passwd'}}),reason('unsupported_harness_plan'));
  await assert.rejects(harness.runTsHarness({...plan,mocks:[{module:'../../escape.ts',exports:{db:'recordAll'},sinkKind:'db_write'}]}),reason('unsupported_harness_plan'));
  await fs.symlink('/etc/passwd',path.join(plan.repositoryRoot,'src/escape.ts'));
  await assert.rejects(harness.runTsHarness({...plan,entryPoint:{...plan.entryPoint,file:'src/escape.ts'}}),reason('unsupported_harness_plan'));
  for(const kind of ['next_app_route','next_pages_api','lambda']) await assert.rejects(harness.runTsHarness({...plan,entryPoint:{...plan.entryPoint,kind}}),reason('adapter_not_implemented'));
  await assert.rejects(harness.runTsHarness({...plan,mocks:[{module:'./missing',exports:{db:'recordAll'},sinkKind:'db_write'}]}),reason('mock_resolution_failed'));
});
test('customer throw is behavior; import failure and process crash are harness failures', async t => {
  const plan=await setup(t,'throwing'); const sig=await harness.runTsHarness(plan);
  assert.deepEqual(sig.threw,{name:'TypeError',message:'customer failure'});
  await assert.rejects(harness.runTsHarness({...plan,entryPoint:{...plan.entryPoint,exportName:'crash'}}),reason('harness_could_not_run'));
  await assert.rejects(harness.runTsHarness({...plan,entryPoint:{...plan.entryPoint,exportName:'killed'}}),reason('harness_could_not_run'));
  await fs.writeFile(path.join(plan.repositoryRoot,'src/bad.ts'),"throw new Error('import failed'); export function handler() {};");
  await assert.rejects(harness.runTsHarness({...plan,entryPoint:{...plan.entryPoint,file:'src/bad.ts',exportName:'handler'}}),reason('harness_could_not_run')); await clean(plan);
});
test('real timers still settle and synchronous hangs are killed and cleaned', async t => {
  const plan=await setup(t,'asyncTimer'); assert.equal((await harness.runTsHarness(plan)).returned,1767225600000);
  for (const exportName of ['hanging', 'promiseHang']) {
    const pidPath=path.join(plan.repositoryRoot, 'child.pid');
    await fs.writeFile(path.join(plan.repositoryRoot, 'fixture.json'),JSON.stringify({pidPath}));
    const before=Date.now();
    await assert.rejects(harness.runTsHarness({...plan,entryPoint:{...plan.entryPoint,exportName}},{timeoutMs:2000}),reason('harness_timeout'));
    assert.ok(Date.now()-before<7000);
    const pid=Number(await fs.readFile(pidPath,'utf8'));
    assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
    await clean(plan);
  }
});
test('actual fetch/http/https/net/named-import attempts never reach a local listener, even when caught', async t => {
  let connections=0;
  const server=http.createServer((_req,res)=>res.end('unexpected'));
  server.on('connection',socket=>{connections++;socket.destroy();});
  server.listen(0,'127.0.0.1'); await once(server,'listening'); t.after(()=>new Promise(resolve=>server.close(resolve)));
  const plan=await setup(t,'egress');
  for (const api of ['fetch','http','https','net','named']) {
    await fs.writeFile(path.join(plan.repositoryRoot,'fixture.json'),JSON.stringify({port:server.address().port,api}));
    await assert.rejects(harness.runTsHarness(plan),error=>{
      assert.ok(reason('blocked_egress')(error)); assert.match(error.diagnostics.attempts,/blocked_egress/);
      assert.doesNotMatch(error.diagnostics.attempts,/do-not-log|token/); return true;
    });
  }
  assert.equal(connections,0); await clean(plan);
});
test('parent rejects malformed and wrong-identity child output', async t => {
  const plan=await setup(t); const sig=await harness.runTsHarness(plan);
  for (const result of [null,{}, {signature:{}}, {signature:{...sig,runIndex:99}}, {signature:{...sig,calls:[{seq:2,mock:'bad',sinkKind:'db_write',args:[]}]}}]) assert.throws(()=>harness.acceptChildResult(result,plan),reason('invalid_child_output'));
});
