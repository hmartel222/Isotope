const test = require('node:test');
const assert = require('node:assert/strict');
const { fixtures, clone } = require('./fixtures/contracts.cjs');
const reporter = require('@isotope/reporter');

function evidence(verdict = 'FAIL') {
  const report=clone(fixtures.IsotopeReport);report.verdict.verdict=verdict;report.verdict.results[0].verdict=verdict;
  const diff=clone(fixtures.DiffReport);if(verdict==='PASS'||verdict==='SKIP')diff.divergences=[];
  if(verdict==='ESCALATE'){diff.divergences[0].kind='value_changed';diff.divergences[0].tier='semantic_question';diff.divergences[0].severity=null;diff.divergences[0].ambiguityCandidate=true;}
  if(verdict==='INDETERMINATE'){diff.stable=false;diff.divergences[0].kind='unstable';diff.divergences[0].tier='mechanical';diff.divergences[0].severity=null;}
  return {report,selected:clone(fixtures.SelectedSpecs),bdg:verdict==='SKIP'?null:clone(fixtures.BDG),diffs:verdict==='SKIP'?[]:[diff],signatures:[clone(fixtures.Signature),clone(fixtures.Signature)]};
}

test('reporter renders bounded verdict-specific evidence and keeps SKIP silent',()=>{
  const fail=reporter.renderPrComment(evidence('FAIL'));assert.match(fail,/incompatibility detected/);assert.match(fail,/42/);assert.match(fail,/undefined/);assert.ok(fail.startsWith(reporter.REPORT_MARKER));
  assert.match(reporter.renderPrComment(evidence('PASS')),/compatible/);assert.match(reporter.renderPrComment(evidence('ESCALATE')),/needs a decision/);
  assert.match(reporter.renderPrComment(evidence('INDETERMINATE')),/could not establish stable behavior/);assert.equal(reporter.renderPrComment(evidence('SKIP')),null);
  const hostile=evidence('FAIL');hostile.selected.specs[0].id='bad<!-- isotope-report -->\n# injected';const rendered=reporter.renderPrComment(hostile);assert.equal((rendered.match(/<!-- isotope-report -->/g)||[]).length,1);assert.ok(rendered.length<=20000);
  assert.deepEqual(['PASS','SKIP','FAIL','ESCALATE','INDETERMINATE'].map(reporter.mapVerdictToConclusion),['success','success','failure','failure','neutral']);
  assert.equal(reporter.buildAnnotations(evidence('FAIL'))[0].annotation_level,'failure');assert.equal(reporter.buildAnnotations(evidence('ESCALATE'))[0].annotation_level,'warning');assert.deepEqual(reporter.buildAnnotations(evidence('SKIP')),[]);
});

test('comment publication creates once, updates one bot-owned marker, and preserves verdict on API errors',async()=>{
  const comments=[];const calls={create:0,update:0,check:0};
  const client={async listIssueComments(){return{data:comments}},async createIssueComment(x){calls.create++;comments.push({id:1,body:x.body,user:{login:'github-actions[bot]',type:'Bot'}})},async updateIssueComment(x){calls.update++;comments[0].body=x.body},async createCheck(){calls.check++}};
  const input={client,owner:'o',repo:'r',pullNumber:1,headSha:'a'.repeat(40),evidence:evidence('FAIL')};
  await reporter.publishGitHubReport(input);await reporter.publishGitHubReport(input);assert.deepEqual(calls,{create:1,update:1,check:2});assert.equal(comments.length,1);
  comments.unshift({id:2,body:reporter.REPORT_MARKER,user:{login:'human',type:'User'}});await reporter.publishGitHubReport(input);assert.equal(calls.create,1);assert.equal(calls.update,2);assert.equal(comments[0].user.login,'human');
  const denied={async listIssueComments(){throw new Error('403 Resource not accessible')},async createIssueComment(){},async updateIssueComment(){},async createCheck(){throw new Error('rate limit')}};
  const result=await reporter.publishGitHubReport({...input,client:denied});assert.equal(result.comment,'failed');assert.equal(result.check,'failed');assert.equal(input.evidence.report.verdict.verdict,'FAIL');assert.equal(result.errors.length,2);
});

test('reporter offers only verified repair diffs and suppresses rejected candidate code',()=>{
  const verified=evidence('FAIL');verified.report.verifiedRepairs=[clone(fixtures.VerifiedRepair)];verified.report.repairVerifications=[clone(fixtures.RepairVerification)];
  const rendered=reporter.renderPrComment(verified);assert.match(rendered,/Verified repair available/);assert.match(rendered,/```diff/);assert.match(rendered,/held-out fixture: PASS/);assert.match(rendered,/Nothing was committed/);
  const rejected=evidence('FAIL');const failure=clone(fixtures.RepairVerification);failure.outcome='overfit_rejected';failure.reason='held-out mismatch';rejected.report.repairVerifications=[failure];rejected.report.verifiedRepairs=[];
  const rejectedText=reporter.renderPrComment(rejected);assert.match(rejectedText,/did not satisfy/);assert.match(rejectedText,/overfit_rejected/);assert.doesNotMatch(rejectedText,/```diff/);
  assert.equal(reporter.mapVerdictToConclusion(verified.report.verdict.verdict),'failure');
});
