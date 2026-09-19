const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const core = require('@isotope/core');
const yaml = require('../packages/cli/node_modules/yaml');
const root = path.resolve(__dirname,'..');
async function project(t) {
  const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'isotope-phase5-')));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  await fs.cp(path.join(root,'examples/walking-skeleton/src'),path.join(directory,'src'),{recursive:true});
  await fs.copyFile(path.join(root,'examples/walking-skeleton/isotope.yml'),path.join(directory,'isotope.yml'));
  return directory;
}
async function cli(directory,command,fixture='broken') {
  let code=0,stdout='',stderr='';
  try { ({stdout,stderr}=await execute(process.execPath,[path.join(root,'packages/cli/dist/bin.js'),command],{cwd:directory,env:{...process.env,ISOTOPE_TEST_FIXTURES:path.isAbsolute(fixture)?fixture:path.join(root,'packages/harness-ts/test-fixtures',fixture)},timeout:90000})); }
  catch(e){code=e.code;stdout=e.stdout;stderr=e.stderr;}
  return {code,stdout,stderr};
}
async function artifacts(directory) {
  const p=core.artifactPaths(directory);
  const bdg=await core.readJsonArtifact(p.root,p.bdg,'BDG');
  const report=await core.readJsonArtifact(p.root,p.report,'IsotopeReport');
  const verdict=await core.readJsonArtifact(p.root,p.verdict,'VerdictReport');
  const diffs=[];
  for(const ref of report.diffReportRefs) diffs.push(await core.readJsonArtifact(p.root,path.join(p.root,ref),'DiffReport'));
  for(const ref of report.signatureRefs) await core.readJsonArtifact(p.root,path.join(p.root,ref),'Signature');
  return {bdg,report,verdict,diffs};
}
test('Phase 5 scan writes a real graph without fixtures, execution, or a stub',async t=>{
  const directory=await project(t);
  // An executable top-level failure proves scan never imports customer code.
  await fs.appendFile(path.join(directory,'src/webhook.ts'),'\nthrow new Error("scan must never execute me");\n');
  const result=await cli(directory,'scan','/does/not/exist');assert.equal(result.code,0,result.stderr);
  assert.match(result.stdout,/Provider roots: 1; affected sites: 1/);assert.match(result.stdout,/\[high\].*db.subscription.update/);
  const p=core.artifactPaths(directory);const bdg=await core.readJsonArtifact(p.root,p.bdg,'BDG');
  assert.equal(bdg.affectedSites[0].provenance.confidence,'high');
  await assert.rejects(fs.access(p.verdict),{code:'ENOENT'});await assert.rejects(fs.access(path.join(p.root,'signatures')),{code:'ENOENT'});
});
test('Phase 5 real L2 -> L3 -> L4 missing field FAIL has an exact BDG association',async t=>{
  const directory=await project(t);const result=await cli(directory,'verify');assert.equal(result.code,1,result.stderr);
  const {bdg,diffs,verdict}=await artifacts(directory);const d=diffs[0].divergences[0];
  assert.equal(verdict.verdict,'FAIL');assert.equal(d.kind,'value_to_missing');assert.equal(d.severity,'critical');
  assert.equal(d.pointer,'/calls/0/args/0/data/renewalDate');assert.ok(d.bdgNodeId);
  assert.ok(bdg.affectedSites.some(s=>s.provenance.confidence==='high'&&s.sinkNodeIds.includes(d.bdgNodeId)));
  assert.equal(diffs[0].stable,true);
});
test('Phase 5 aggregation graph accompanies semantic ESCALATE',async t=>{
  const directory=await project(t);
  await fs.writeFile(path.join(directory,'src/webhook.ts'),`import Stripe from 'stripe'; import {db} from './db'; const stripe=new Stripe('inert');
export function handler(req,res) { const event=stripe.webhooks.constructEvent(req.rawBody,'',''); const renewal=Math.max(...event.data.object.items.data.map(item=>item.current_period_end)); db.subscription.update({data:{renewalDate:renewal}}); return res.status(200).json({received:true}); }`);
  const fixture=path.join(directory,'synthetic');await fs.mkdir(fixture);
  for(const side of ['old','new']) { const event=JSON.parse(await fs.readFile(path.join(root,'packages/harness-ts/test-fixtures/control',side+'.json'),'utf8')); event.data.object.items={data:[{current_period_end:side==='old'?100:200},{current_period_end:50}]}; await fs.writeFile(path.join(fixture,side+'.json'),JSON.stringify(event)); }
  await fs.writeFile(path.join(fixture,'meta.json'),JSON.stringify({synthetic:true,provenance:'internal-controlled'}));
  const result=await cli(directory,'verify',fixture);assert.equal(result.code,3,result.stderr);
  const {bdg,diffs,verdict}=await artifacts(directory);assert.equal(verdict.verdict,'ESCALATE');
  assert.ok(bdg.nodes.some(n=>n.kind==='transform'&&n.aggregation));assert.equal(diffs[0].divergences[0].kind,'value_changed');
  assert.equal(diffs[0].divergences[0].ambiguityCandidate,true);
  assert.ok(diffs[0].divergences[0].bdgNodeId);assert.deepEqual([diffs[0].divergences[0].old,diffs[0].divergences[0].new],[100,200]);
});
test('Phase 5 wrong provider is skipped without executing unrelated code or requiring fixtures',async t=>{
  const directory=await project(t);await fs.writeFile(path.join(directory,'src/webhook.ts'),`import Payjp from 'payjp'; import {db} from './db'; const stripe=new Payjp('inert'); throw new Error('must never execute'); export function handler(req,res){const event=stripe.webhooks.constructEvent('','',''); db.subscription.update({value:event.data.object.current_period_end});}`);
  const result=await cli(directory,'verify','/does/not/exist');assert.equal(result.code,0,result.stderr);
  const {bdg,report,verdict}=await artifacts(directory);assert.equal(verdict.verdict,'SKIP');assert.equal(verdict.results[0].reason,'no_taint_root');
  assert.equal(bdg.affectedSites.length,0);assert.deepEqual(report.signatureRefs,[]);
});
test('Phase 5 multiple configured entries produce deterministic scoped artifacts and aggregate FAIL',async t=>{
  const directory=await project(t);await fs.appendFile(path.join(directory,'src/webhook.ts'),`\nexport function control(req,res){stripe.webhooks.constructEvent(req.rawBody,'','');return res.status(200).json({received:true});}`);
  const config=yaml.parse(await fs.readFile(path.join(directory,'isotope.yml'),'utf8'));config.entryPoints.push({...config.entryPoints[0],export:'control'});await fs.writeFile(path.join(directory,'isotope.yml'),JSON.stringify(config));
  const result=await cli(directory,'verify');assert.equal(result.code,1,result.stderr);
  const {report,verdict,diffs}=await artifacts(directory);assert.equal(report.signatureRefs.length,8);assert.equal(diffs.length,2);
  assert.equal(verdict.verdict,'FAIL');assert.deepEqual(verdict.results.map(r=>r.verdict).sort(),['FAIL','PASS']);
  assert.equal(new Set(report.signatureRefs).size,8);
});
test('Phase 5 mechanical runtime loss remains authoritative beyond static call bounds',async t=>{
  const directory=await project(t);await fs.writeFile(path.join(directory,'src/webhook.ts'),`import Stripe from 'stripe';import {db} from './db';const stripe=new Stripe('inert');function second(value){db.subscription.update({data:{renewalDate:value}});}function first(value){second(value);}export function handler(req,res){const event=stripe.webhooks.constructEvent(req.rawBody,'','');first(event.data.object.current_period_end);return res.status(200).json({received:true});}`);
  const result=await cli(directory,'verify');assert.equal(result.code,1,result.stderr);
  const {bdg,diffs,verdict}=await artifacts(directory);assert.equal(verdict.verdict,'FAIL');assert.equal(bdg.sinks.length,0);assert.ok(bdg.skipped.some(d=>d.reason==='local_call_limit:1'));
  assert.equal(diffs[0].divergences[0].bdgNodeId,null);assert.equal(diffs[0].divergences[0].kind,'value_to_missing');assert.equal(diffs[0].divergences[0].severity,'critical');
});
test('Phase 5 low-confidence name evidence never schedules customer execution',async t=>{
  const directory=await project(t);await fs.writeFile(path.join(directory,'src/webhook.ts'),`import {db} from './db';throw new Error('must not execute');export function handler(subscription){db.subscription.update(subscription.current_period_end);}`);
  const result=await cli(directory,'verify','/does/not/exist');assert.equal(result.code,0,result.stderr);
  const {bdg,report,verdict}=await artifacts(directory);assert.equal(verdict.verdict,'SKIP');assert.deepEqual(report.signatureRefs,[]);assert.ok(bdg.affectedSites.length);assert.ok(bdg.affectedSites.every(s=>s.provenance.confidence==='low'));
});
test('Phase 5 reaching the call bound before discovering a root is INDETERMINATE, not a complete no-root claim',async t=>{
  const directory=await project(t);await fs.writeFile(path.join(directory,'src/webhook.ts'),`import Stripe from 'stripe';const stripe=new Stripe('inert');function second(){return stripe.webhooks.constructEvent('','','');}function first(){return second();}export function handler(){first();}`);
  const result=await cli(directory,'verify','/does/not/exist');assert.equal(result.code,4,result.stderr);
  const {bdg,report,verdict}=await artifacts(directory);assert.equal(verdict.verdict,'INDETERMINATE');assert.equal(verdict.results[0].reason,'incomplete_static_analysis');assert.ok(bdg.skipped.some(d=>d.reason==='local_call_limit:1'));assert.deepEqual(report.signatureRefs,[]);
});
