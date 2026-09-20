const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const core = require('@isotope/core');
const root = path.resolve(__dirname, '..');
const yaml = require('../packages/cli/node_modules/yaml');
const scenarios = [
  {name:'identical',old:{value:100},new:{value:100},verdict:'PASS',exit:0,kinds:[]},
  {name:'missing',old:{value:100},new:{value:null},verdict:'FAIL',exit:1,kinds:['value_to_missing']},
  {name:'value',old:{value:100},new:{value:200},verdict:'ESCALATE',exit:3,kinds:['value_changed']},
  {name:'type',old:{value:100},new:{value:'100'},verdict:'ESCALATE',exit:3,kinds:['type_changed']},
  {name:'added-field',old:{value:{id:'A'}},new:{value:{id:'A',label:'new'}},verdict:'PASS',exit:0,kinds:['field_added']},
  {name:'add',old:{value:100,enabled:false},new:{value:100,enabled:true},verdict:'ESCALATE',exit:3,kinds:['call_added']},
  {name:'drop',old:{value:100,enabled:true},new:{value:100,enabled:false},verdict:'FAIL',exit:1,kinds:['call_dropped']},
  {name:'args',old:{value:100},new:{value:100,extraArgument:true},verdict:'ESCALATE',exit:3,kinds:['call_args_changed']},
  {name:'log',old:{value:'A'},new:{value:'B'},verdict:'PASS',exit:0,kinds:['value_changed']},
  {name:'throw',old:{value:100,enabled:false},new:{value:100,enabled:true},verdict:'FAIL',exit:1,kinds:['value_to_missing','threw_new_only']},
  {name:'unstable',old:{value:100},new:{value:100},verdict:'INDETERMINATE',exit:4,kinds:['unstable','unstable']},
];
for (const scenario of scenarios) test(`real L3 -> L4 -> L6 -> CLI: ${scenario.name} -> ${scenario.verdict}`, async t=>{
  const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'isotope-phase4-')));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  await fs.cp(path.join(root,'packages/differ/test-projects/structural'),directory,{recursive:true});
  const config=yaml.parse(await fs.readFile(path.join(root,'examples/walking-skeleton/isotope.yml'),'utf8'));
  if(scenario.name==='log') config.mocks[0].sinkKind='log_only';
  await fs.writeFile(path.join(directory,'isotope.yml'),JSON.stringify(config));
  const bdg=JSON.parse(await fs.readFile(path.join(root,'examples/walking-skeleton/bdg.stub.json'),'utf8'));
  for(const node of bdg.nodes) node.provenance.evidenceRefs=['Manually authored synthetic L4 integration graph; not AST output'];
  if(scenario.name==='log') bdg.sinks[0].kind='log_only';
  await fs.writeFile(path.join(directory,'bdg.stub.json'),JSON.stringify(bdg));
  const fixtureDirectory=path.join(directory,'synthetic-fixtures');await fs.mkdir(fixtureDirectory);
  for(const side of ['old','new']) {
    const payload=JSON.parse(await fs.readFile(path.join(root,`packages/harness-ts/test-fixtures/control/${side}.json`),'utf8'));
    Object.assign(payload.data.object,{scenario:scenario.name},scenario[side]);
    await fs.writeFile(path.join(fixtureDirectory,side+'.json'),JSON.stringify(payload));
  }
  await fs.writeFile(path.join(fixtureDirectory,'meta.json'),JSON.stringify({synthetic:true,provenance:'internal-controlled',purpose:'Phase 4 internal structural routing test'}));
  let exit=0,stdout='';
  try {const result=await execute(process.execPath,[path.join(root,'packages/cli/dist/bin.js'),'verify','--no-reasoner','--no-repair'],{cwd:directory,env:{...process.env,ISOTOPE_TEST_FIXTURES:fixtureDirectory},timeout:60000});stdout=result.stdout;}
  catch(error){exit=error.code;stdout=error.stdout;}
  assert.equal(exit,scenario.exit,stdout);assert.match(stdout,new RegExp('Verdict: '+scenario.verdict));assert.match(stdout,/SYNTHETIC TEST-ONLY/);
  if(exit===3) assert.match(stdout,/Semantic reasoner: disabled; decision required|semantic_reasoner_unavailable/);
  const p=core.artifactPaths(directory);
  const diff=await core.readJsonArtifact(p.root,p.diffReport,'DiffReport');
  const verdict=await core.readJsonArtifact(p.root,p.verdict,'VerdictReport');
  const report=await core.readJsonArtifact(p.root,p.report,'IsotopeReport');
  assert.equal(verdict.verdict,scenario.verdict);assert.deepEqual(diff.divergences.map(d=>d.kind),scenario.kinds);
  assert.deepEqual(report.reasoningRefs,[]);assert.deepEqual(report.evidencePacketRefs,[]);assert.deepEqual(report.repairVerifications,[]);
  assert.equal(report.signatureRefs.length,4);
  for(const ref of report.signatureRefs) await core.readJsonArtifact(p.root,path.join(p.root,ref),'Signature');
  assert.equal(diff.stable,scenario.name!=='unstable');
  if(scenario.name==='value') {
    assert.deepEqual([diff.divergences[0].old,diff.divergences[0].new],[100,200]);
    assert.equal(diff.divergences[0].pointer,'/calls/0/args/0/data/renewalDate');assert.equal(diff.divergences[0].tier,'semantic_question');
    assert.equal(verdict.results[0].provenance,'unavailable');
  }
  if(['added-field','log'].includes(scenario.name)) {
    assert.equal(diff.divergences[0].severity,'info');assert.equal(verdict.results[0].reason,'only_informational_divergences');
  }
  for(const dir of ['reasoning','evidence-packets','repair']) await assert.rejects(fs.access(path.join(p.root,dir)),{code:'ENOENT'});
});
