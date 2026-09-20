const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const { fixtures, clone } = require('./fixtures/contracts.cjs');
const root=path.resolve(__dirname,'..');

test('Action context uses exact PR SHAs and rejects missing or malformed payloads',()=>{
  const {parsePullRequestPayload}=require('../action/dist/context.cjs');const base='a'.repeat(40),head='b'.repeat(40);
  assert.deepEqual(parsePullRequestPayload({number:7,repository:{full_name:'owner/repo'},sender:{login:'dependabot[bot]'},pull_request:{base:{sha:base},head:{sha:head}}}),{owner:'owner',repo:'repo',pullNumber:7,baseSha:base,headSha:head,actor:'dependabot[bot]'});
  assert.throws(()=>parsePullRequestPayload({}),/pull_request/);assert.throws(()=>parsePullRequestPayload({number:1,repository:{full_name:'o/r'},pull_request:{base:{sha:'HEAD^'},head:{sha:head}}}),/full 40-character/);
});

test('bundled report-only Action validates artifacts, emits outputs, and maps PASS to success',async t=>{
  const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'isotope-action-')));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const art=path.join(dir,'.isotope');await fs.mkdir(art);
  const report=clone(fixtures.IsotopeReport);report.verdict.verdict='PASS';report.verdict.results[0].verdict='PASS';report.verdict.results[0].divergenceIds=[];
  await Promise.all([['isotope-report.json',report],['selected-specs.json',fixtures.SelectedSpecs],['bdg.json',fixtures.BDG],['diff-report.json',{...fixtures.DiffReport,divergences:[]}],['old.json',fixtures.Signature],['new.json',{...fixtures.Signature,payloadVersion:'new-v2'}],['verdict.json',report.verdict]].map(([name,value])=>fs.writeFile(path.join(art,name),JSON.stringify(value))));
  const event=path.join(dir,'event.json');await fs.writeFile(event,JSON.stringify({number:9,repository:{full_name:'o/r'},pull_request:{base:{sha:'a'.repeat(40)},head:{sha:'b'.repeat(40)}}}));
  const outputs=path.join(dir,'outputs');const summary=path.join(dir,'summary');await fs.writeFile(outputs,'');await fs.writeFile(summary,'');
  const result=await execute(process.execPath,[path.join(root,'action/dist/index.js')],{cwd:root,env:{...process.env,GITHUB_EVENT_PATH:event,GITHUB_WORKSPACE:root,GITHUB_OUTPUT:outputs,GITHUB_STEP_SUMMARY:summary,INPUT_MODE:'report','INPUT_ARTIFACT-ROOT':art,INPUT_REASONER:'off',INPUT_REPAIR:'off',NODE_NO_WARNINGS:'1'},timeout:30000});
  assert.doesNotMatch(result.stderr,/Error|error/);assert.match(await fs.readFile(outputs,'utf8'),/verdict<<ISOTOPE_EOF\nPASS/);assert.match(await fs.readFile(summary,'utf8'),/Isotope: PASS/);
});

async function customerRepo(t, source) {
  const repo=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'isotope-action-verify-')));
  t.after(()=>fs.rm(repo,{recursive:true,force:true}));
  await fs.cp(source,repo,{recursive:true});
  await fs.mkdir(path.join(repo,'.github'),{recursive:true});
  await fs.writeFile(path.join(repo,'.github/dependabot.yml'),'version: 2\nupdates:\n  - package-ecosystem: npm\n    directory: "/"\n    schedule: { interval: daily }\n');
  const git=async(...args)=>execute('git',args,{cwd:repo});
  await git('init','--quiet');await git('config','user.email','action@test.invalid');await git('config','user.name','Action Test');
  await fs.writeFile(path.join(repo,'package.json'),JSON.stringify({dependencies:{stripe:'17.7.0'}}));
  await git('add','.');await git('commit','--quiet','-m','base');
  const base=(await git('rev-parse','HEAD')).stdout.trim();
  await fs.writeFile(path.join(repo,'package.json'),JSON.stringify({dependencies:{stripe:'18.1.0'}}));
  await git('add','package.json');await git('commit','--quiet','-m','head');
  const head=(await git('rev-parse','HEAD')).stdout.trim();
  const event=path.join(repo,'event.json');
  await fs.writeFile(event,JSON.stringify({number:3,repository:{full_name:'o/r'},pull_request:{base:{sha:base},head:{sha:head}}}));
  const outputs=path.join(repo,'outputs');await fs.writeFile(outputs,'');
  return {repo,event,outputs};
}

test('bundled verify Action invokes the shared L1-L4 engine once and maps mechanical FAIL to failure',async t=>{
  const {repo,event,outputs}=await customerRepo(t,path.join(root,'corpus/cases/repositories/mechanical-break'));
  const synthetic=path.join(repo,'internal-test-fixture');await fs.cp(path.join(root,'corpus/cases/fixtures/sub-updated-single'),synthetic,{recursive:true});
  let failure,success;try{success=await execute(process.execPath,[path.join(root,'action/dist/index.js')],{cwd:repo,env:{...process.env,GITHUB_EVENT_PATH:event,GITHUB_WORKSPACE:repo,GITHUB_OUTPUT:outputs,INPUT_REASONER:'off',INPUT_REPAIR:'off','INPUT_SPECS-PATH':'','INPUT_FIXTURES-PATH':'',ISOTOPE_ACTION_TEST_MODE:'1',ISOTOPE_INTERNAL_TEST_FIXTURES:synthetic},timeout:90000});}catch(error){failure=error;}
  const report=JSON.parse(await fs.readFile(path.join(repo,'.isotope/isotope-report.json'),'utf8'));
  assert.equal(failure?.code,1,`${failure?.stderr ?? success?.stdout ?? 'action exited successfully'}; verdict=${report.verdict.verdict}; reason=${report.verdict.results[0]?.reason}`);assert.match(await fs.readFile(outputs,'utf8'),/verdict<<ISOTOPE_EOF\nFAIL/);
  const actionOutput=`${failure?.stdout ?? success?.stdout ?? ''}`;
  assert.match(actionOutput,/::notice title=Isotope repair::Repair%3A disabled/);
  assert.equal(report.verdict.verdict,'FAIL');assert.equal(report.selectedSpecs.specs[0].id,'stripe.basil.subscription-period');assert.equal(report.signatureRefs.length,4);
});

test('Action uses bundled registries when the customer repo has no specs or fixtures',async t=>{
  const {repo,event,outputs}=await customerRepo(t,path.join(root,'harness/stripe/targets/01-mechanical'));
  assert.equal(await fs.access(path.join(repo,'specs')).then(()=>'present',()=>'absent'),'absent');
  assert.equal(await fs.access(path.join(repo,'fixtures')).then(()=>'present',()=>'absent'),'absent');
  let failure,success;try{success=await execute(process.execPath,[path.join(root,'action/dist/index.js')],{cwd:repo,env:{...process.env,GITHUB_EVENT_PATH:event,GITHUB_WORKSPACE:repo,GITHUB_OUTPUT:outputs,INPUT_REASONER:'off',INPUT_REPAIR:'off','INPUT_SPECS-PATH':'','INPUT_FIXTURES-PATH':''},timeout:120000});}catch(error){failure=error;}
  const stdout=`${failure?.stdout ?? success?.stdout ?? ''}`;
  const stderr=`${failure?.stderr ?? success?.stderr ?? ''}`;
  const report=JSON.parse(await fs.readFile(path.join(repo,'.isotope/isotope-report.json'),'utf8'));
  assert.match(stdout,/ChangeSpec registry: .*\/registry\/specs/);
  assert.doesNotMatch(stdout,/Invalid ChangeSpec/);
  assert.doesNotMatch(stderr,/Invalid ChangeSpec/);
  assert.equal(failure?.code,1,`${stderr || stdout}; verdict=${report.verdict.verdict}; reason=${report.verdict.results[0]?.reason}`);
  assert.equal(report.verdict.verdict,'FAIL');
  assert.equal(report.selectedSpecs.specs[0].id,'stripe.basil.subscription-period');
  assert.equal(report.signatureRefs.length,4);
  assert.match(await fs.readFile(path.join(repo,'.isotope/isotope-report.json'),'utf8'),/sub-updated-single/);
});

test('bundled Action resolves and executes the Python sidecar from a remote-Action layout',async t=>{
  const repo=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'isotope-action-python-')));t.after(()=>fs.rm(repo,{recursive:true,force:true}));
  await fs.cp(path.join(root,'corpus/cases/repositories/python-elevenlabs'),repo,{recursive:true});
  const git=async(...args)=>execute('git',args,{cwd:repo});
  await git('init','--quiet');await git('config','user.email','action@test.invalid');await git('config','user.name','Action Test');
  await fs.writeFile(path.join(repo,'requirements.txt'),'elevenlabs==0.2.27\n');await git('add','.');await git('commit','--quiet','-m','base');
  const base=(await git('rev-parse','HEAD')).stdout.trim();
  await fs.writeFile(path.join(repo,'requirements.txt'),'elevenlabs==1.0.0\n');await git('add','requirements.txt');await git('commit','--quiet','-m','head');
  const head=(await git('rev-parse','HEAD')).stdout.trim();
  const event=path.join(repo,'event.json');await fs.writeFile(event,JSON.stringify({number:4,repository:{full_name:'o/r'},pull_request:{base:{sha:base},head:{sha:head}}}));
  const outputs=path.join(repo,'outputs');await fs.writeFile(outputs,'');
  const synthetic=path.join(repo,'internal-test-fixture');await fs.cp(path.join(root,'corpus/cases/fixtures/el-tts'),synthetic,{recursive:true});
  let failure,success;try{success=await execute(process.execPath,[path.join(root,'action/dist/index.js')],{cwd:repo,env:{...process.env,GITHUB_EVENT_PATH:event,GITHUB_WORKSPACE:repo,GITHUB_OUTPUT:outputs,INPUT_REASONER:'off',INPUT_REPAIR:'off','INPUT_SPECS-PATH':'','INPUT_FIXTURES-PATH':'',ISOTOPE_ACTION_TEST_MODE:'1',ISOTOPE_INTERNAL_TEST_FIXTURES:synthetic},timeout:90000});}catch(error){failure=error;}
  const report=JSON.parse(await fs.readFile(path.join(repo,'.isotope/isotope-report.json'),'utf8'));
  assert.equal(failure?.code,1,`${failure?.stderr ?? success?.stdout ?? 'action exited successfully'}; verdict=${report.verdict.verdict}; reason=${report.verdict.results[0]?.reason}`);
  assert.equal(report.verdict.verdict,'FAIL');assert.equal(report.selectedSpecs.specs[0].provider,'elevenlabs');assert.equal(report.signatureRefs.length,4);
});

test('workflow templates never grant contents write or use pull_request_target',async()=>{
  const files=await Promise.all(['isotope.yml','isotope-verify.yml','isotope-report.yml'].map(f=>fs.readFile(path.join(root,'.github/workflows',f),'utf8')));
  for(const text of files){assert.doesNotMatch(text,/contents:\s*write/);assert.doesNotMatch(text,/pull_request_target/);}
  assert.match(files[1],/contents: read/);assert.doesNotMatch(files[1],/pull-requests: write|checks: write/);assert.match(files[2],/workflow_run/);assert.match(files[2],/default_branch/);
  const customer=[await fs.readFile(path.join(root,'harness/stripe/customer-template/.github/workflows/isotope-verify.yml'),'utf8'),await fs.readFile(path.join(root,'harness/stripe/customer-template/.github/workflows/isotope-report.yml'),'utf8')];
  for(const text of customer){assert.doesNotMatch(text,/contents:\s*write/);assert.doesNotMatch(text,/pull_request_target/);assert.doesNotMatch(text,/corepack enable/);}
  assert.match(customer[0],/contents: read/);assert.match(customer[0],/include-hidden-files: true/);assert.match(customer[1],/workflow_run/);
  for(const repo of ['isotope-demo-elevenlabs-removal','isotope-demo-elevenlabs-fallback']) {
    const verify=await fs.readFile(path.join(root,'harness/elevenlabs/customer-repos',repo,'.github/workflows/isotope-verify.yml'),'utf8');
    const report=await fs.readFile(path.join(root,'harness/elevenlabs/customer-repos',repo,'.github/workflows/isotope-report.yml'),'utf8');
    for(const text of [verify,report]) { assert.doesNotMatch(text,/contents:\s*write/);assert.doesNotMatch(text,/pull_request_target/); }
    assert.match(verify,/ISOTOPE_PYTHON_OLD/);assert.match(verify,/ISOTOPE_PYTHON_NEW/);assert.match(verify,/specs-path: specs/);assert.match(verify,/fixtures-path: fixtures\/normalized/);
    assert.match(report,/workflow_run/);assert.match(report,/pull-requests: write/);
  }
});
