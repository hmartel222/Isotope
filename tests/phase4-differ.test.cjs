const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('@isotope/core');
const differ = require('@isotope/differ');
const { fixtures, clone } = require('./fixtures/contracts.cjs');
const signature = (returned = { status: 200 }, calls = []) => ({ ...clone(fixtures.Signature), returned, calls });
const call = (args, mock='db.record', sinkKind='db_write', seq=0) => ({ seq, mock, sinkKind, args });
function input(old, next, bdg=clone(fixtures.BDG)) {
  return { old, new: next, bdg, selfComparisons: { old:[clone(old),clone(old)],new:[clone(next),clone(next)] } };
}
function verdict(diff, extra={}) { return core.resolveVerdict({entryPoint:fixtures.EntryPoint,bdg:fixtures.BDG,config:fixtures.IsotopeConfig,reasoning:null,diff,...extra}); }
const argsInput = (a,b) => input(signature(undefined,[call(a)]), signature(undefined,[call(b)]));
function check(report, expectedVerdict) {
  core.validateContract('DiffReport',report);
  const result=verdict(report); core.validateContract('VerdictResult',result);
  assert.equal(result.verdict,expectedVerdict);
  assert.deepEqual(result.divergenceIds,report.divergences.map(d=>d.id));
  assert.deepEqual(result.reasoningRefs,[]);
  assert.deepEqual(result.evidenceRefs,report.divergences.map(d=>({kind:'diff',pointer:d.pointer})));
  return result;
}
for(const [name, a,b,kind,tier,severity,outcome] of [
  ['value',1,2,'value_changed','semantic_question',null,'ESCALATE'],
  ['numeric to string',1,'1','type_changed','semantic_question',null,'ESCALATE'],
  ['string to boolean','true',true,'type_changed','semantic_question',null,'ESCALATE'],
  ['object to array',{},[],'type_changed','semantic_question',null,'ESCALATE'],
  ['array to object',[],{},'type_changed','semantic_question',null,'ESCALATE'],
  ['false to null',false,null,'value_to_missing','mechanical','critical','FAIL'],
  ['zero to undefined',0,'__undefined__','value_to_missing','mechanical','critical','FAIL'],
  ['empty string to null','',null,'value_to_missing','mechanical','critical','FAIL'],
  ['object to missing',{x:1},'__undefined__','value_to_missing','mechanical','critical','FAIL'],
  ['null to defined',null,1,'type_changed','semantic_question',null,'ESCALATE'],
  ['undefined to defined','__undefined__','active','type_changed','semantic_question',null,'ESCALATE'],
  ['null to undefined',null,'__undefined__','type_changed','semantic_question',null,'ESCALATE'],
  ['undefined to null','__undefined__',null,'type_changed','semantic_question',null,'ESCALATE'],
  ['serialized NaN','__NaN__','__Infinity__','value_changed','semantic_question',null,'ESCALATE'],
  ['function sentinel','__fn__','__circular__','value_changed','semantic_question',null,'ESCALATE'],
  ['string sentinel to numeric','__NaN__',1,'type_changed','semantic_question',null,'ESCALATE'],
]) test(`classification: ${name}`,()=>{
  const report=differ.diffSignatures(argsInput([{value:a}],[{value:b}]));
  assert.deepEqual(report.divergences,[{id:'d0',pointer:'/calls/0/args/0/value',sinkKind:'db_write',old:a,new:b,kind,tier,severity,bdgNodeId:'sink'}]);
  const result=check(report,outcome); assert.equal(result.provenance,outcome==='ESCALATE'?'unavailable':'mechanical');
});
for(const value of [null,'__undefined__',false,0,'',{},[],{b:2,a:1},['__fn__','__circular__']]) test(`exact equivalence ${JSON.stringify(value)}`,()=>{
  const report=differ.diffSignatures(argsInput([value],[clone(value)]));
  assert.deepEqual(report.divergences,[]); assert.equal(check(report,'PASS').reason,'identical_behavior');
  assert.equal(core.needsSemanticReasoning(report),false);
});
test('central missing/type helpers distinguish falsy values, null, arrays, objects and sentinels',()=>{
  for(const v of [null,'__undefined__']) assert.equal(differ.isMissing(v),true);
  for(const v of [0,false,'',[],{},'__NaN__']) assert.equal(differ.isMissing(v),false);
  for(const [v,type] of [[null,'null'],['__undefined__','undefined'],[true,'boolean'],[1,'number'],['x','string'],[[],'array'],[{},'object']]) assert.equal(differ.normalizedType(v),type);
});
for(const value of [0,false,'',12,{},[]]) test(`absent property loses defined ${JSON.stringify(value)}`,()=>{
  const report=differ.diffSignatures(argsInput([{value}],[{}]));
  assert.equal(report.divergences[0].kind,'value_to_missing'); assert.equal(report.divergences[0].new,'__undefined__');check(report,'FAIL');
});
for(const value of [null,'__undefined__']) test(`removing already missing ${value} is not authoritative loss`,()=>{
  const report=differ.diffSignatures(argsInput([{value}],[{}]));
  assert.equal(report.divergences[0].kind,'type_changed');check(report,'ESCALATE');
});
test('additive object keys are info, including nested fields and null/undefined values',()=>{
  const report=differ.diffSignatures(argsInput([{a:{id:1}}],[{a:{id:1,z:null},b:'__undefined__'}]));
  assert.deepEqual(report.divergences.map(d=>[d.pointer,d.kind,d.tier,d.severity]),[
    ['/calls/0/args/0/a/z','field_added','mechanical','info'],['/calls/0/args/0/b','field_added','mechanical','info']]);
  assert.equal(check(report,'PASS').reason,'only_informational_divergences');
});
for(const [a,b,kind,pointer,outcome] of [
  [[1],[1,2],'call_args_changed','/calls/0/args/1','ESCALATE'],
  [[1],[1,null],'call_args_changed','/calls/0/args/1','ESCALATE'],
  [[1,2],[1],'value_to_missing','/calls/0/args/1','FAIL'],
  [[1,null],[1],'call_args_changed','/calls/0/args/1','ESCALATE'],
  [[{nested:[1]}],[{nested:[1,2]}],'call_args_changed','/calls/0/args/0/nested/1','ESCALATE'],
  [[{nested:[1,2]}],[{nested:[1]}],'value_to_missing','/calls/0/args/0/nested/1','FAIL'],
]) test(`argument collections ${JSON.stringify(a)} -> ${JSON.stringify(b)}`,()=>{
  const report=differ.diffSignatures(argsInput(a,b)); assert.equal(report.divergences.length,1);
  assert.equal(report.divergences[0].kind,kind);assert.equal(report.divergences[0].pointer,pointer);check(report,outcome);
});
test('array reordering is positional, without duplicate argument summaries',()=>{
  const report=differ.diffSignatures(argsInput([['a','b']],[['b','a']]));
  assert.deepEqual(report.divergences.map(d=>[d.pointer,d.kind]),[['/calls/0/args/0/0','value_changed'],['/calls/0/args/0/1','value_changed']]);
});
test('missing leaf beats generic argument change, even alongside an added argument',()=>{
  const report=differ.diffSignatures(argsInput([{value:1}],[{value:null},true]));
  assert.deepEqual(report.divergences.map(d=>d.kind),['value_to_missing','call_args_changed']);check(report,'FAIL');
});
for(const [a,b,kind] of [[[1],[1,2],'value_changed'],[[1,null],[1],'value_changed'],[[1,2],[1],'value_to_missing'],[{status:200},{status:500},'value_changed'],[{}, {new:1},'field_added']]) test(`returned state ${JSON.stringify(a)} -> ${JSON.stringify(b)}`,()=>{
  const report=differ.diffSignatures(input(signature(a),signature(b)));
  assert.equal(report.divergences[0].kind,kind);assert.equal(report.divergences[0].sinkKind,'returned_state');
  check(report,kind==='value_to_missing'?'FAIL':kind==='field_added'?'PASS':'ESCALATE');
});
test('new-only throws are mechanical; removed and changed errors remain semantic',()=>{
  const old=signature(),next=signature();next.threw={name:'TypeError',message:'new'};
  const added=differ.diffSignatures(input(old,next));assert.deepEqual(added.divergences.map(d=>[d.kind,d.pointer,d.sinkKind,d.severity]),[['threw_new_only','/threw',null,'high']]);check(added,'FAIL');
  const removed=differ.diffSignatures(input(next,old)); assert.equal(removed.divergences[0].kind,'value_changed');check(removed,'ESCALATE');
  const changed=clone(next);changed.threw={name:'Error',message:'different'};
  const report=differ.diffSignatures(input(next,changed));assert.deepEqual(report.divergences.map(d=>d.pointer),['/threw/message','/threw/name']);check(report,'ESCALATE');
  const stack=clone(next);stack.threw.stack='stable optional stack';
  assert.equal(differ.diffSignatures(input(stack,next)).divergences[0].kind,'type_changed');
  check(differ.diffSignatures(input(stack,next)),'ESCALATE');
  check(differ.diffSignatures(input(next,clone(next))),'PASS');
});
test('call identity is mock plus sink kind, never arguments',()=>{
  assert.ok(differ.sameCall(call([1]),call([2])));assert.equal(differ.sameCall(call([]),call([],'other')),false);
  assert.equal(differ.sameCall(call([]),call([],'db.record','email')),false);
});
test('positional replacement emits dropped then added, with exact evidence',()=>{
  const a=call([1],'db.record'),b=call([1],'email.send','email');
  const report=differ.diffSignatures(input(signature({},[a]),signature({},[b])));
  assert.deepEqual(report.divergences,[
    {id:'d0',kind:'call_dropped',pointer:'/calls/0',sinkKind:'db_write',old:a,new:'__undefined__',tier:'mechanical',severity:'critical',bdgNodeId:'sink'},
    {id:'d1',kind:'call_added',pointer:'/calls/0',sinkKind:'email',old:'__undefined__',new:b,tier:'semantic_question',severity:null,bdgNodeId:null},
  ]);check(report,'FAIL');
});
test('call added is semantic; call dropped is critical; no fuzzy alignment',()=>{
  const a=call([], 'A'),b=call([], 'B','email',1),x=call([],'X');
  check(differ.diffSignatures(input(signature(),signature(undefined,[a]))),'ESCALATE');
  check(differ.diffSignatures(input(signature(undefined,[a]),signature())),'FAIL');
  const report=differ.diffSignatures(input(signature(undefined,[a,b]),signature(undefined,[x,{...a,seq:1},{...b,seq:2}])));
  assert.deepEqual(report.divergences.map(d=>[d.kind,d.pointer]),[['call_dropped','/calls/0'],['call_added','/calls/0'],['call_dropped','/calls/1'],['call_added','/calls/1'],['call_added','/calls/2']]);check(report,'FAIL');
});
for(const [a,b,expected] of [
  [[call([1],'log','log_only')],[call([2],'log','log_only')],'value_changed'],
  [[call([1],'log','log_only')],[call(['1'],'log','log_only')],'type_changed'],
  [[],[call([1],'log','log_only')],'call_added'],
  [[call([1],'log','log_only')],[call([1,2],'log','log_only')],'call_args_changed'],
]) test(`log-only downgrades semantic ${expected}`,()=>{
  const report=differ.diffSignatures(input(signature(undefined,a),signature(undefined,b)));
  assert.equal(report.divergences[0].kind,expected);assert.equal(report.divergences[0].tier,'mechanical');assert.equal(report.divergences[0].severity,'info');
  check(report,'PASS');assert.equal(core.needsSemanticReasoning(report),false);
});
test('log-only does not erase authoritative loss or dropped calls',()=>{
  const old=signature(undefined,[call([1],'log','log_only')]);
  for(const next of [signature(),signature(undefined,[call([null],'log','log_only')])]) {
    const report=differ.diffSignatures(input(old,next));assert.equal(report.divergences[0].severity,'critical');check(report,'FAIL');
  }
});
test('deep pointers escape tilde/slash/empty keys and resolve to exact evidence',()=>{
  const a={customer:{billing:{period:{'~end/value':100,'':1}}}},b=clone(a);b.customer.billing.period['~end/value']=200;b.customer.billing.period['']=null;
  const data=argsInput([a],[b]); const report=differ.diffSignatures(data);
  assert.deepEqual(report.divergences.map(d=>d.pointer),['/calls/0/args/0/customer/billing/period/','/calls/0/args/0/customer/billing/period/~0end~1value']);
  const resolve=(obj,p)=>p.slice(1).split('/').reduce((v,k)=>v[k.replace(/~1/g,'/').replace(/~0/g,'~')],obj);
  for(const d of report.divergences) {assert.deepEqual(resolve(data.old,d.pointer),d.old);assert.deepEqual(resolve(data.new,d.pointer),d.new);}
});
test('deterministic order and IDs: returned, threw, numeric calls, sorted object keys',()=>{
  const old=signature({z:0,a:0},Array.from({length:12},(_,i)=>call([{z:0,a:0}],'db.record','db_write',i)));
  const next=signature({a:1,z:1},Array.from({length:12},(_,i)=>call([{a:1,z:1}],'db.record','db_write',i)));
  const a=differ.diffSignatures(input(old,next)); const b=differ.diffSignatures(input(clone(old),clone(next)));
  assert.deepEqual(a,b);assert.deepEqual(a.divergences.slice(0,4).map(d=>d.pointer),['/returned/a','/returned/z','/calls/0/args/0/a','/calls/0/args/0/z']);
  assert.ok(a.divergences.findIndex(d=>d.pointer.startsWith('/calls/9/'))<a.divergences.findIndex(d=>d.pointer.startsWith('/calls/10/')));
  assert.deepEqual(a.divergences.map(d=>d.id),a.divergences.map((_,i)=>'d'+i));
});
test('metadata never causes divergence; original versus patched code retains distinct refs',()=>{
  const old=clone(fixtures.Signature);const next={...clone(old),entryPointId:'other',codeVersion:'patched:r4',fixturePair:'heldout',payloadVersion:'new',runIndex:4,durationMs:12345};
  const report=differ.diffSignatures(input(old,next));check(report,'PASS');assert.ok(differ.behaviorEqual(old,next));
  assert.deepEqual(Object.keys(differ.behavioralView(old)).sort(),['calls','returned','threw']);
  assert.match(report.oldSignatureRef,/signatures\/original\//);assert.match(report.newSignatureRef,/signatures\/patched%3Ar4\/heldout\//);
});
test('unstable old/new self-comparisons short-circuit classification and preserve pointers',()=>{
  const data=argsInput([{value:1}],[{value:null}]);data.selfComparisons.old[1].calls[0].args[0].value=3;
  data.selfComparisons.new[1].returned={status:201};
  const report=differ.diffSignatures(data);assert.equal(report.stable,false);
  assert.deepEqual(report.unstablePointers,['/calls/0/args/0/value','/returned/status']);
  assert.ok(report.divergences.every(d=>d.kind==='unstable' && d.tier==='mechanical' && d.severity===null));
  check(report,'INDETERMINATE');assert.equal(core.needsSemanticReasoning(report),false);
});
test('new side alone can be unstable; duplicate unstable pointers are retained once in the index',()=>{
  const data=argsInput([1],[1]);data.selfComparisons.new[1].calls[0].args[0]=2;
  check(differ.diffSignatures(data),'INDETERMINATE');
  data.selfComparisons.old[1].calls[0].args[0]=3;
  const report=differ.diffSignatures(data);assert.deepEqual(report.unstablePointers,['/calls/0/args/0']);assert.equal(report.divergences.length,2);
});
test('BDG association requires unique matching sink, kind and entry point, but not confidence',()=>{
  const data=argsInput([1],[null]);
  for(const node of data.bdg.nodes) node.provenance.confidence='low';
  for(const site of data.bdg.affectedSites) site.provenance.confidence='low';
  let report=differ.diffSignatures(data);assert.equal(report.divergences[0].bdgNodeId,'sink');assert.equal(verdict(report,{bdg:data.bdg}).verdict,'FAIL');
  for(const mutate of [b=>b.sinks.push(clone(b.sinks[0])),b=>b.sinks[0].kind='email',b=>b.nodes[1].entryPointId='other',b=>b.nodes[1].kind='binding',b=>b.nodes=[],b=>b.sinks=[]]) {
    const bdg=clone(fixtures.BDG);mutate(bdg);report=differ.diffSignatures({...data,bdg});assert.equal(report.divergences[0].bdgNodeId,null);check(report,'FAIL');
  }
  delete data.bdg; report=differ.diffSignatures(data);assert.equal(report.divergences[0].bdgNodeId,null);check(report,'FAIL');
});
test('returned state association is unique and scoped, otherwise absent',()=>{
  const data=input(signature({a:1}),signature({a:2}));const b=data.bdg;
  b.sinks.push({...b.sinks[0],nodeId:'return',kind:'returned_state'});b.nodes.push({...b.nodes[1],id:'return'});
  assert.equal(differ.diffSignatures(data).divergences[0].bdgNodeId,'return');
  b.sinks.push({...b.sinks.at(-1),nodeId:'return2'});b.nodes.push({...b.nodes.at(-1),id:'return2'});
  assert.equal(differ.diffSignatures(data).divergences[0].bdgNodeId,null);
});
test('ambiguity flags scoped semantic evidence only; pointer boundaries are respected',()=>{
  const data=argsInput([{value:1,valueExtra:1,lost:1}],[{value:2,valueExtra:2,lost:null,added:1}]);
  data.changeContext={ambiguitySatisfied:true,affectedPointers:['/calls/0/args/0/value','/calls/0/args/0/lost']};
  const report=differ.diffSignatures(data);assert.deepEqual(report.divergences.filter(d=>d.ambiguityCandidate).map(d=>d.pointer),['/calls/0/args/0/value']);check(report,'FAIL');
  data.changeContext.ambiguitySatisfied=false;assert.ok(differ.diffSignatures(data).divergences.every(d=>d.ambiguityCandidate===undefined));
  data.changeContext={ambiguitySatisfied:true,affectedPointers:['']};assert.equal(differ.diffSignatures(data).divergences.filter(d=>d.ambiguityCandidate).length,2);
  const log=input(signature(undefined,[call([1],'log','log_only')]),signature(undefined,[call([2],'log','log_only')]));log.changeContext=data.changeContext;
  assert.equal(differ.diffSignatures(log).divergences[0].ambiguityCandidate,undefined);
  data.changeContext.affectedPointers=['/bad~pointer'];assert.throws(()=>differ.diffSignatures(data),core.ArtifactValidationError);
});
test('multiple divergence precedence and mechanical authority bypass all supplied reasoning',()=>{
  for(const [a,b,outcome] of [
    [[{v:1}],[{v:2,added:1}],'ESCALATE'],
    [[{v:1,lost:1}],[{v:2,lost:null}],'FAIL'],
  ]) {const report=differ.diffSignatures(argsInput(a,b));check(report,outcome);assert.equal(core.needsSemanticReasoning(report),outcome==='ESCALATE');}
  const report=differ.diffSignatures(argsInput([{v:1}],[{v:null}]));
  const opaque={get reasoning(){throw new Error('reasoning must not be read');},get bdg(){throw new Error('provenance must not gate structural truth');},get config(){throw new Error('config cannot override mechanical authority');}};
  // Explicit accessors exercise the bypass, not a mocked model invocation.
  const resolverInput={entryPoint:fixtures.EntryPoint,diff:report};Object.defineProperties(resolverInput,Object.getOwnPropertyDescriptors(opaque));
  assert.equal(core.resolveVerdict(resolverInput).verdict,'FAIL');
  const unstable=clone(report);unstable.stable=false;assert.equal(verdict(unstable).verdict,'INDETERMINATE');
  const marked=clone(report);marked.divergences[0].kind='unstable';assert.equal(verdict(marked).verdict,'INDETERMINATE');assert.equal(core.needsSemanticReasoning(marked),false);
  const residual=differ.diffSignatures(argsInput([1],[2]));
  const fake={status:'completed',results:[{classification:'benign_adaptation',confidence:'high'}]};
  assert.equal(verdict(residual,{reasoning:fake}).verdict,'ESCALATE');
});
test('combined additive and log-only changes pass with nonempty informational evidence',()=>{
  const old=signature({id:1},[call([1],'log','log_only')]); const next=signature({id:1,added:2},[call([2],'log','log_only')]);
  const report=differ.diffSignatures(input(old,next));assert.equal(report.divergences.length,2);check(report,'PASS');
});
test('invalid signatures, seq and inconsistent self-comparison inputs are artifact errors',()=>{
  const data=argsInput([1],[2]);
  const invalid=clone(data);invalid.old.calls[0].seq=5;assert.throws(()=>differ.diffSignatures(invalid),core.ArtifactValidationError);
  const broken=clone(data);delete broken.new.returned;assert.throws(()=>differ.diffSignatures(broken),core.ArtifactValidationError);
  const mismatch=clone(data);mismatch.selfComparisons.old[0].calls[0].args=[7];assert.throws(()=>differ.diffSignatures(mismatch),core.ArtifactValidationError);
  const mismatchNew=clone(data);mismatchNew.selfComparisons.new[0].calls[0].args=[7];assert.throws(()=>differ.diffSignatures(mismatchNew),core.ArtifactValidationError);
  assert.throws(()=>verdict({...fixtures.DiffReport,stable:'not boolean'}),core.ArtifactValidationError);
  assert.throws(()=>verdict({...fixtures.DiffReport,entryPointId:'wrong-entry'}),core.ArtifactValidationError);
});
test('pure in-memory comparison never mutates frozen inputs or reads external state',()=>{
  const data=argsInput([{b:1,a:2}],[{a:3,b:1}]);
  function freeze(value) {if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}}
  freeze(data); const before=JSON.stringify(data);const first=differ.diffSignatures(data);const second=differ.diffSignatures(data);
  assert.deepEqual(first,second);assert.equal(JSON.stringify(data),before);
});
