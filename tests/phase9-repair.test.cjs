const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const root = path.resolve(__dirname, '..');
const repair = require('@isotope/repair');
const { loadWalkingSkeletonSpec } = require('@isotope/changespec');
const { verifyWalkingSkeleton, verifyRepository } = require('@isotope/cli');
const { resolveBehavioralDependencyGraph } = require('@isotope/resolver-ts');
const { runHarness } = require('@isotope/harness-ts');
const { diffSignatures } = require('@isotope/differ');
const { resolveVerdict } = require('@isotope/core');
const { verifyRepair } = require('@isotope/verifier');

const event = count => ({ object:'event', type:'customer.subscription.updated', api_version:'new', data:{ object:{ object:'subscription', id:'sub', items:{ data:Array.from({length:count},(_,i)=>({current_period_end:100+i})) } } } });
test('restricted repair predicates and pure eligibility enforce policy before codemod safety', async () => {
  assert.deepEqual(repair.evaluateRepairPredicate('items.data.length == 1', event(1)), { supported:true, value:true });
  assert.deepEqual(repair.evaluateRepairPredicate('items.data.length > 1 && items.data.length <= 3', event(2)), { supported:true, value:true });
  assert.equal(repair.evaluateRepairPredicate('process.exit()', event(1)).supported, false);
  const selected = await loadWalkingSkeletonSpec(path.join(root,'specs')); const spec=selected.specs[0];
  const site={id:'s',entryPointId:'ep',nodeId:'n',specId:spec.id,changeIndex:0,location:{file:'src/a.ts',line:1,column:1},sinkNodeIds:['sink'],provenance:{confidence:'high',provider:'stripe',specId:spec.id,basis:'provider_call'}};
  const input={verdict:{entryPointId:'ep',verdict:'FAIL',provenance:'mechanical',reason:'mechanical_incompatibility',divergenceIds:['d'],reasoningRefs:[],evidenceRefs:[],suspectedInjection:false},bdg:{schemaVersion:1,entryPoints:[],nodes:[],edges:[],sinks:[],affectedSites:[site],skipped:[]},selectedSpecs:selected,
    config:{repair:{mode:'on',planner:'deterministic-only',verify:true,maxAttempts:1,maxFiles:3,maxChangedLines:80,selfConsistency:false,redact:false}},fixture:{},newPayload:event(1)};
  assert.equal(repair.evaluateRepairEligibility(input).eligible,true);
  const unsafe=repair.evaluateRepairEligibility({...input,newPayload:event(2)}); assert.equal(unsafe.eligible,false); assert.equal(unsafe.reason,'business_policy_required');
  assert.equal(repair.evaluateRepairEligibility({...input,verdict:{...input.verdict,verdict:'ESCALATE'}}).reason,'verdict_not_mechanical_fail');
  assert.equal(repair.evaluateRepairEligibility({...input,bdg:{...input.bdg,affectedSites:[{...site,provenance:{...site.provenance,confidence:'low'}}]}}).reason,'authoritative_site_required');
});

function candidate(pathName='src/a.ts',anchor='obj.old',replacement='obj.next') { return {repairId:'r-test',classification:'repair_candidate',confidence:'high',summary:'test',causalChain:'test',assumptions:[],evidenceRefs:[],humanQuestion:null,suspectedInjection:false,abstain:false,origin:'deterministic',patch:{files:[{path:pathName,edits:[{anchor,replacement}]}]}}; }
async function tempProject(t) { const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'isotope-repair-unit-'))); t.after(()=>fs.rm(dir,{recursive:true,force:true})); await fs.mkdir(path.join(dir,'src')); await fs.writeFile(path.join(dir,'src/a.ts'),'export const value = obj.old;\n'); await fs.writeFile(path.join(dir,'package.json'),'{}\n'); return dir; }
test('candidate validator rejects traversal, forbidden/dependency files, duplicate anchors and budgets', async t => {
  const repo=await tempProject(t); const base={repoRoot:repo,allowedPaths:['src/a.ts'],maxFiles:3,maxChangedLines:80};
  await assert.rejects(repair.validateCandidatePatch({...base,candidate:candidate('../a.ts')}),/unsafe path|allow-list/);
  await assert.rejects(repair.validateCandidatePatch({...base,allowedPaths:['package.json'],candidate:candidate('package.json','{}','{"dependencies":{}}')}),/forbidden/);
  await fs.writeFile(path.join(repo,'src/a.ts'),'obj.old; obj.old;\n');
  await assert.rejects(repair.validateCandidatePatch({...base,candidate:candidate()}),/exactly once/);
  await fs.writeFile(path.join(repo,'src/a.ts'),'obj.old;\n');
  await assert.rejects(repair.validateCandidatePatch({...base,maxChangedLines:1,candidate:candidate()}),/line budget/);
  const outside=path.join(path.dirname(repo),'outside-repair.ts'); await fs.writeFile(outside,'obj.old;\n'); t.after(()=>fs.rm(outside,{force:true})); await fs.symlink(outside,path.join(repo,'src/link.ts'));
  await assert.rejects(repair.validateCandidatePatch({...base,allowedPaths:['src/link.ts'],candidate:candidate('src/link.ts')}),/symlink/);
});

test('ephemeral copy applies a real diff, leaves original bytes intact, and disposes', async t => {
  const repo=await tempProject(t); const before=await fs.readFile(path.join(repo,'src/a.ts'));
  const applied=await repair.applyCandidatePatch({repoRoot:repo,repairId:'r-test',candidate:candidate(),allowedPaths:['src/a.ts'],maxFiles:3,maxChangedLines:80});
  assert.match(applied.diff,/^-.*obj\.old/m); assert.match(applied.diff,/^\+.*obj\.next/m);
  assert.equal((await fs.readFile(path.join(repo,'src/a.ts'))).compare(before),0); const workspace=applied.workspaceRoot;
  await applied.dispose(); await assert.rejects(fs.access(workspace),{code:'ENOENT'});
});

test('ephemeral workspace is destroyed when the verifier callback throws', async t => {
  const repo=await tempProject(t); const temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'isotope-verifier-throw-'))); t.after(()=>fs.rm(temp,{recursive:true,force:true})); let workspace;
  await assert.rejects(repair.withAppliedCandidate({repoRoot:repo,temporaryRoot:temp,repairId:'r-test',candidate:candidate(),allowedPaths:['src/a.ts'],maxFiles:3,maxChangedLines:80},async applied=>{workspace=applied.workspaceRoot;throw new Error('verifier exploded');}),/verifier exploded/);
  await assert.rejects(fs.access(workspace),{code:'ENOENT'}); assert.deepEqual(await fs.readdir(temp),[]);
});

test('workspace is destroyed when post-creation anchor validation throws', async t => {
  const repo=await tempProject(t); await execute('git',['init','--quiet'],{cwd:repo}); await execute('git',['config','user.email','test@local'],{cwd:repo}); await execute('git',['config','user.name','Test'],{cwd:repo}); await execute('git',['add','.'],{cwd:repo}); await execute('git',['commit','--quiet','-m','base'],{cwd:repo});
  await fs.writeFile(path.join(repo,'src/a.ts'),'export const value = obj.changed;\n');
  const temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'isotope-repair-cleanup-'))); t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  await assert.rejects(repair.applyCandidatePatch({repoRoot:repo,temporaryRoot:temp,repairId:'r-test',candidate:candidate('src/a.ts','obj.changed','obj.next'),allowedPaths:['src/a.ts'],maxFiles:3,maxChangedLines:80}),/workspace anchor/);
  assert.deepEqual(await fs.readdir(temp),[]);
});

test('multi-item business policy bypass keeps the original FAIL and produces no patch', {timeout:120000}, async t => {
  const repo=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'isotope-phase9-policy-'))); t.after(()=>fs.rm(repo,{recursive:true,force:true})); await fs.cp(path.join(root,'corpus/cases/repositories/mechanical-break'),repo,{recursive:true});
  const configPath=path.join(repo,'isotope.yml'); const config=JSON.parse(await fs.readFile(configPath,'utf8')); config.repair.mode='on'; await fs.writeFile(configPath,JSON.stringify(config,null,2)+'\n'); await fs.writeFile(path.join(repo,'.gitignore'),'.isotope/\n');
  const selected=await loadWalkingSkeletonSpec(path.join(root,'specs')); const run=await verifyWalkingSkeleton({configPath,selectedSpecs:selected,testFixtureDirectory:path.join(root,'corpus/cases/fixtures/sub-updated-multi'),disableReasoner:true,disableRepair:false});
  assert.equal(run.report.verdict.verdict,'FAIL'); assert.equal(run.exitCode,1); assert.equal(run.report.candidateRefs.length,0); assert.match(run.output,/business_policy_required/);
});

test('real L1-adjacent Stripe corpus FAIL is repaired only in a worktree and independently verified on held-out evidence', {timeout:120000}, async t => {
  const repo=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'isotope-phase9-e2e-'))); t.after(()=>fs.rm(repo,{recursive:true,force:true}));
  await fs.cp(path.join(root,'corpus/cases/repositories/mechanical-break'),repo,{recursive:true});
  const configPath=path.join(repo,'isotope.yml'); const config=JSON.parse(await fs.readFile(configPath,'utf8')); config.repair.mode='on';
  await fs.writeFile(configPath,JSON.stringify(config,null,2)+'\n'); await fs.writeFile(path.join(repo,'package.json'),JSON.stringify({private:true,dependencies:{stripe:'17.7.0'}},null,2)+'\n'); await fs.writeFile(path.join(repo,'.gitignore'),'.isotope/\n');
  await execute('git',['init','--quiet'],{cwd:repo}); await execute('git',['config','user.email','acceptance@isotope.local'],{cwd:repo}); await execute('git',['config','user.name','Isotope Acceptance'],{cwd:repo}); await execute('git',['add','.'],{cwd:repo}); await execute('git',['commit','--quiet','-m','phase9'],{cwd:repo});
  await execute('git',['tag','phase9-base'],{cwd:repo}); await fs.writeFile(path.join(repo,'package.json'),JSON.stringify({private:true,dependencies:{stripe:'18.1.0'}},null,2)+'\n'); await execute('git',['add','package.json'],{cwd:repo}); await execute('git',['commit','--quiet','-m','upgrade stripe'],{cwd:repo}); await execute('git',['tag','phase9-head'],{cwd:repo});
  const source=path.join(repo,'src/webhook.ts'); const before=crypto.createHash('sha256').update(await fs.readFile(source)).digest('hex');
  const run=await verifyRepository({repositoryRoot:repo,configPath,specsPath:path.join(root,'specs'),baseRef:'phase9-base',headRef:'phase9-head',reasoner:'off',repair:'on',testFixtureDirectory:path.join(root,'corpus/cases/fixtures/sub-updated-single')});
  assert.match(run.output,/stripe 17\.7\.0 → 18\.1\.0/); assert.equal(run.report.verdict.verdict,'FAIL'); assert.equal(run.exitCode,5,run.output); assert.equal(run.report.verifiedRepairs.length,1); assert.equal(run.report.repairVerifications[0].outcome,'verified');
  assert.equal(run.report.repairVerifications[0].planning.baselineEquivalent,true); assert.equal(run.report.repairVerifications[0].heldOut.baselineEquivalent,true);
  assert.ok(Object.values(run.report.repairVerifications[0].shapeChecks).every(Boolean)); assert.match(run.report.verifiedRepairs[0].diff,/items\.data\[0\]\.current_period_end/);
  assert.equal(crypto.createHash('sha256').update(await fs.readFile(source)).digest('hex'),before); assert.equal((await execute('git',['status','--porcelain'],{cwd:repo})).stdout,'');
  await fs.access(path.join(repo,'.isotope/repair/verified-repair.json')); await fs.access(path.join(repo,'.isotope/repair/verification',`${run.report.verifiedRepairs[0].repairId}.json`));
  let cliError; try { await execute(process.execPath,[path.join(root,'packages/cli/dist/bin.js'),'--config','isotope.yml','repair','handler'],{cwd:repo,env:{...process.env,ISOTOPE_TEST_FIXTURES:path.join(root,'corpus/cases/fixtures/sub-updated-single')}}); } catch(error) { cliError=error; }
  assert.equal(cliError?.code,5); assert.match(cliError?.stdout ?? '',/Original verdict: FAIL[\s\S]*Repair: VERIFIED/);
});

test('baseline equivalence rejects a candidate that fools patched-old versus patched-new', () => {
  const signature=value=>({entryPointId:'ep',codeVersion:'original',payloadVersion:'v',fixturePair:'pair',runIndex:0,returned:null,threw:null,calls:[{seq:0,mock:'db.update',sinkKind:'db_write',args:[value]}],durationMs:1});
  const baseline=signature(10); const badOld={...signature(99),codeVersion:'patched:r',runIndex:0}; const badOld2={...badOld,runIndex:1}; const badNew={...badOld,payloadVersion:'new'}; const badNew2={...badNew,runIndex:1};
  const secondary=diffSignatures({old:badOld,new:badNew,selfComparisons:{old:[badOld,badOld2],new:[badNew,badNew2]}});
  const authoritative=diffSignatures({old:baseline,new:badNew,selfComparisons:{old:[baseline,{...baseline,runIndex:1}],new:[badNew,badNew2]}});
  assert.equal(secondary.divergences.length,0); assert.ok(authoritative.divergences.some(d=>d.kind==='value_changed'));
});

test('independent verifier rejects broken and hardcoded candidates with distinct outcomes', {timeout:120000}, async t => {
  const repo=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'isotope-phase9-negative-'))); t.after(()=>fs.rm(repo,{recursive:true,force:true}));
  await fs.cp(path.join(root,'corpus/cases/repositories/mechanical-break'),repo,{recursive:true}); const config=JSON.parse(await fs.readFile(path.join(repo,'isotope.yml'),'utf8')); config.repair.mode='on';
  await fs.writeFile(path.join(repo,'isotope.yml'),JSON.stringify(config,null,2)+'\n'); await fs.writeFile(path.join(repo,'package.json'),'{}\n'); await fs.writeFile(path.join(repo,'.gitignore'),'.isotope/\n');
  await execute('git',['init','--quiet'],{cwd:repo}); await execute('git',['config','user.email','test@local'],{cwd:repo}); await execute('git',['config','user.name','Test'],{cwd:repo}); await execute('git',['add','.'],{cwd:repo}); await execute('git',['commit','--quiet','-m','negative'],{cwd:repo});
  const selected=await loadWalkingSkeletonSpec(path.join(root,'specs')); const spec=selected.specs[0]; const bdg=await resolveBehavioralDependencyGraph({repositoryRoot:repo,config,changeSpec:spec}); const entry=bdg.entryPoints[0];
  const makeFixture=async(name,role)=>{const dir=path.join(root,'corpus/cases/fixtures',name);const old=JSON.parse(await fs.readFile(path.join(dir,'old.json'),'utf8'));const next=JSON.parse(await fs.readFile(path.join(dir,'new.json'),'utf8'));return {id:`synthetic-${name}`,role,oldPath:path.join(dir,'old.json'),newPath:path.join(dir,'new.json'),oldVersion:old.api_version,newVersion:next.api_version,newPayload:next};};
  const planning=await makeFixture('sub-updated-single','planning'); const heldOut=await makeFixture('sub-updated-single-B','held_out');
  const originalPlanning=await runHarness({repoRoot:repo,config,entryPoint:entry,bdg,fixture:planning,codeVersion:'original'}); const originalHeldOut=await runHarness({repoRoot:repo,config,entryPoint:entry,bdg,fixture:heldOut,codeVersion:'original'});
  const originalDiff=diffSignatures({old:originalPlanning.old[0],new:originalPlanning.new[0],bdg,selfComparisons:originalPlanning}); const originalVerdict=resolveVerdict({entryPoint:entry,bdg,diff:originalDiff,reasoning:null,config}); assert.equal(originalVerdict.verdict,'FAIL');
  const eligibility=repair.evaluateRepairEligibility({verdict:originalVerdict,bdg,selectedSpecs:selected,config,fixture:planning,newPayload:planning.newPayload}); const generated=await repair.generateDeterministicCandidate({repoRoot:repo,bdg,spec,entryPointId:entry.id,siteIds:eligibility.siteIds,changeIndex:eligibility.changeIndex});
  async function check(replacement,expected) { const candidate=structuredClone(generated); candidate.patch.files[0].edits[0].replacement=replacement; const applied=await repair.applyCandidatePatch({repoRoot:repo,repairId:candidate.repairId,candidate,allowedPaths:repair.allowedPathsFromBDG(bdg,entry.id),maxFiles:3,maxChangedLines:80}); try { const result=await verifyRepair({repairId:candidate.repairId,workspaceRoot:applied.workspaceRoot,artifactRoot:repo,candidate,candidateDiff:applied.diff,config,selectedSpecs:selected,originalBDG:bdg,entryPoint:entry,originalVerdict,planning:{fixture:planning,original:originalPlanning},heldOut:{fixture:heldOut,original:originalHeldOut}}); assert.equal(result.verification.outcome,expected); assert.equal(result.verifiedRepair,null); } finally { await applied.dispose(); } }
  await check('event.data.object.items.data[0].current_period_end + 1','did_not_restore_behavior');
  await check('1700000123','overfit_rejected');
});
