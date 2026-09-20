const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const core = require('@isotope/core');
const { resolveBehavioralDependencyGraph: resolve } = require('@isotope/resolver-ts');
const { loadWalkingSkeletonSpec } = require('@isotope/changespec');
const yaml = require('../packages/cli/node_modules/yaml');
const root = path.resolve(__dirname, '..');
async function setup(t, name = 'direct', file = 'cases.ts', extra = {}) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'isotope-l2-')));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.cp(path.join(root, 'packages/resolver-ts/test-projects/flows'), directory, { recursive: true });
  await fs.symlink(path.join(root, 'node_modules'), path.join(directory, 'node_modules'));
  const config = yaml.parse(await fs.readFile(path.join(root, 'examples/walking-skeleton/isotope.yml'), 'utf8'));
  config.entryPoints = [{ file, export: name, kind: 'plain' }];
  config.mocks[0].module = './db'; Object.assign(config, extra);
  const changeSpec = (await loadWalkingSkeletonSpec(path.join(root, 'specs'), 'stripe.basil.subscription-period')).specs[0];
  return { repositoryRoot: directory, config, changeSpec };
}
const db = b => b.sinks.filter(s => s.kind === 'db_write');
const node = (b,id) => b.nodes.find(n => n.id === id);
for (const name of ['direct','typed','destructuring','bracket','cast','namespace']) test(`L2 high-confidence Stripe flow: ${name}`, async t => {
  const input = await setup(t,name); const b = await resolve(input); core.validateContract('BDG', b);
  assert.equal(db(b).length,1, JSON.stringify(b.skipped));
  assert.equal(db(b)[0].name,'db.subscription.update');
  assert.ok(b.affectedSites.some(s => s.provenance.confidence === 'high' && s.sinkNodeIds.includes(db(b)[0].nodeId)));
  assert.ok(b.nodes.every(n => !path.isAbsolute(n.location.file) && n.location.column >= 1 && n.location.endLine >= n.location.line));
  if (name === 'typed') assert.ok(b.nodes.some(n => n.provenance.basis === 'provider_type'));
  if (name === 'cast') assert.ok(b.nodes.some(n => n.path === 'current_period_end' && n.castSuppressed));
});
for (const name of ['aggregation','reduce']) test(`L2 replacement path aggregation: ${name}`, async t => {
  const b = await resolve(await setup(t,name));
  assert.ok(b.nodes.some(n => n.kind === 'transform' && n.aggregation));
  assert.ok(b.affectedSites.some(s => node(b,s.nodeId).path === 'items.data[*].current_period_end' && s.sinkNodeIds.includes(db(b)[0]?.nodeId)),JSON.stringify(b));
  assert.equal(node(b,db(b)[0].nodeId).aggregation,true);
});
test('L2 ordinary transforms form real causal edges', async t => {
  const b = await resolve(await setup(t,'transform'));
  assert.ok(b.nodes.filter(n => n.kind === 'transform').length >= 3);
  assert.ok(b.affectedSites.some(s => s.sinkNodeIds.includes(db(b)[0]?.nodeId)));
  assert.ok(b.edges.every(e => node(b,e.from) && node(b,e.to)));
});
test('L2 branch records control without tainting a constant write', async t => {
  const b = await resolve(await setup(t,'branch'));
  assert.ok(b.nodes.some(n => n.kind === 'branch')); assert.equal(b.sinks.length,0);
});
for (const name of ['oneHop','importedHop']) test(`L2 one helper hop: ${name}`, async t => {
  const b = await resolve(await setup(t,name));
  assert.equal(db(b).length,1,JSON.stringify(b.skipped));
  assert.equal(node(b,db(b)[0].nodeId).provenance.confidence,'medium');
  assert.ok(b.nodes.some(n => n.kind === 'local_call'));
  assert.ok(b.affectedSites.some(s => s.sinkNodeIds.includes(db(b)[0].nodeId)));
});
for (const name of ['twoHop','recursion']) test(`L2 call cutoff terminates: ${name}`, async t => {
  const b = await resolve(await setup(t,name)); assert.equal(db(b).length,0);
  assert.ok(b.skipped.some(s => s.reason === 'local_call_limit:1')); assert.ok(b.nodes.length < 20);
});
test('L2 untainted reassignment clears the sink flow', async t => {
  const b = await resolve(await setup(t,'cleared')); assert.equal(db(b).length,0); assert.ok(b.affectedSites.length);
  assert.ok(b.affectedSites.every(s => s.sinkNodeIds.length === 0));
});
test('L2 one provider re-export is medium', async t => {
  const b = await resolve(await setup(t,'reexport')); assert.equal(db(b).length,1);
  assert.ok(b.affectedSites.every(s => s.provenance.confidence === 'medium'));
  assert.ok(b.nodes.some(n => n.provenance.basis === 'reexport'));
});
for (const [name,file] of [['handler','wrong.ts'],['shadow','cases.ts']]) test(`L2 wrong provider / shadowing has no authoritative flow: ${file}#${name}`, async t => {
  const b = await resolve(await setup(t,name,file)); assert.equal(b.affectedSites.length,0); assert.equal(b.sinks.length,0);
  assert.ok(b.skipped.some(s => s.reason === 'no_taint_root'));
});
for (const [name,kinds] of [['returned',['returned_state']],['multiple',['db_write','log_only','returned_state']],['logging',['log_only']],['http',['http_out','http_out']]]) test(`L2 observable taxonomy: ${name}`, async t => {
  const b = await resolve(await setup(t,name)); assert.deepEqual(b.sinks.map(s => s.kind).sort(),kinds.sort());
  assert.ok(b.affectedSites.some(s => s.sinkNodeIds.length === kinds.length));
});
test('L2 Express response identity comes from configured adapter parameter', async t => {
  const input = await setup(t,'response'); input.config.entryPoints[0].kind='express_route';
  const b = await resolve(input); assert.equal(b.sinks[0].kind,'returned_state');
});
test('L2 dynamic object key is uncertain/low; a known array index is wildcard', async t => {
  const input = await setup(t,'dynamic'); let b = await resolve(input);
  assert.equal(b.affectedSites.length,0);assert.equal(node(b,db(b)[0].nodeId).provenance.confidence,'low');
  assert.ok(b.skipped.some(s => s.reason.startsWith('indeterminate_path')));
  input.config.entryPoints[0].export='indexed'; b=await resolve(input);
  assert.ok(b.affectedSites.some(s => node(b,s.nodeId).path === 'items.data[*].current_period_end'));
});
test('L2 Babel CommonJS fallback uses conservative explicit provenance', async t => {
  const b=await resolve(await setup(t,'handler','common.cjs'));
  assert.equal(db(b).length,1,JSON.stringify(b)); assert.equal(b.affectedSites[0].provenance.confidence,'medium');
  assert.ok(b.skipped.some(s => s.reason.startsWith('js_fallback')));
});
test('L2 output is deterministic and customer source bytes are unchanged', async t => {
  const input=await setup(t,'aggregation');const source=path.join(input.repositoryRoot,'cases.ts');const before=await fs.readFile(source);
  assert.deepEqual(await resolve(input),await resolve(input));assert.deepEqual(await fs.readFile(source),before);
});
test('L2 ignore rules and file cap are explicit', async t => {
  const input=await setup(t,'direct');input.config.ignore=['cases.ts'];let b=await resolve(input);
  assert.equal(b.nodes.length,0);assert.ok(b.skipped.some(s=>s.reason==='ignored_or_outside_repository'));
  input.config.ignore=[];input.config.entryPoints=[{file:'many.ts',export:'handler',kind:'plain'}];
  await fs.writeFile(path.join(input.repositoryRoot,'many.ts'),Array.from({length:205},(_,i)=>`import './f${i}';`).join('\n')+'\nexport function handler() {}');
  await Promise.all(Array.from({length:205},(_,i)=>fs.writeFile(path.join(input.repositoryRoot,`f${i}.ts`),'export {};')));
  b=await resolve(input);assert.ok(b.skipped.some(s=>s.reason==='file_limit:200'));
});
test('L2 unsupported pattern syntax fails explicitly', async t => {
  const input=await setup(t);input.changeSpec.detection.taint_roots=[{kind:'call',language:'ts',pattern:'contains stripe'}];
  await assert.rejects(resolve(input),/Unsupported taint-root/);
});
test('L2 heuristic-only parameter is low, never proven provider provenance', async t => {
  const input=await setup(t,'handler','heuristic.ts');
  await fs.writeFile(path.join(input.repositoryRoot,'heuristic.ts'),`import {db} from './db'; export function handler(subscription){db.subscription.update(subscription.current_period_end);}`);
  const b=await resolve(input);assert.ok(b.affectedSites.length);assert.ok(b.nodes.every(n=>n.provenance.confidence==='low'));
  assert.ok(b.nodes.some(n=>n.provenance.basis==='name_heuristic'));assert.ok(b.skipped.some(d=>d.reason==='no_taint_root'));
});
test('L2 provider-neutral ChangeSpec patterns and configured sink categories', async t => {
  const input=await setup(t,'handler','neutral.ts');input.changeSpec.provider='acme';input.changeSpec.detection.ecosystems.npm.packages=['acme-sdk'];input.changeSpec.detection.taint_roots=[{kind:'call',language:'ts',pattern:'$CLIENT.read($$$)'}];
  input.config.mocks=[{module:'mailer',exports:{send:'recordAll'},sinkKind:'email'},{module:'jobs',exports:{queue:'recordAll'},sinkKind:'queue'}];
  await fs.writeFile(path.join(input.repositoryRoot,'neutral.ts'),`import Client from 'acme-sdk'; import {send as email} from 'mailer'; import {queue} from 'jobs'; const client=new Client(); export function handler(){const sub=client.read();const value=sub.current_period_end;email(value);queue.publish(value);}`);
  const b=await resolve(input);assert.deepEqual(b.sinks.map(s=>[s.kind,s.name]).sort(),[['email','send'],['queue','queue.publish']]);assert.ok(b.nodes.every(n=>n.provenance.provider==='acme'));
});
test('L2 confidence never increases downstream through a helper or dynamic key', async t => {
  const input=await setup(t,'handler','confidence.ts');await fs.writeFile(path.join(input.repositoryRoot,'confidence.ts'),`import Stripe from 'stripe';import {db} from './db';const client=new Stripe('inert');function persist(value){db.subscription.update(value);}export function handler(key){const e=client.webhooks.constructEvent('','','');persist(e.data.object[key]);}`);
  const b=await resolve(input);const rank={low:0,medium:1,high:2};
  for(const edge of b.edges)assert.ok(rank[node(b,edge.to).provenance.confidence]<=rank[node(b,edge.from).provenance.confidence]);
  assert.equal(node(b,db(b)[0].nodeId).provenance.confidence,'low');
});
test('L2 block shadowing and conservative branch assignment joins', async t => {
  const input=await setup(t,'handler','scope.ts');await fs.writeFile(path.join(input.repositoryRoot,'scope.ts'),`import Stripe from 'stripe';import {db} from './db';const stripe=new Stripe('inert');export function handler(flag){const event=stripe.webhooks.constructEvent('','','');let value=event.data.object.current_period_end;if(flag){const value=0;db.subscription.update(value);}else{value=123;}db.subscription.update(value);}`);
  const b=await resolve(input);assert.equal(db(b).length,1);assert.ok(b.affectedSites[0].sinkNodeIds.includes(db(b)[0].nodeId));
});
test('L2 second provider re-export is cut off and diagnosed', async t => {
  const input=await setup(t,'handler','barrel-entry.ts');await fs.writeFile(path.join(input.repositoryRoot,'barrel.ts'),`export {client} from './client';`);await fs.writeFile(path.join(input.repositoryRoot,'barrel-entry.ts'),`import {client} from './barrel';import {db} from './db';export function handler(){const e=client.webhooks.constructEvent('','','');db.subscription.update(e.data.object.current_period_end);}`);
  const b=await resolve(input);assert.equal(b.affectedSites.length,0);assert.ok(b.skipped.some(d=>d.reason==='reexport_limit:1'));
});
test('L2 exact path matching does not match a longer field name', async t=>{
  const input=await setup(t,'handler','paths.ts');await fs.writeFile(path.join(input.repositoryRoot,'paths.ts'),`import Stripe from 'stripe';import {db} from './db';const stripe=new Stripe('inert');export function handler(){const e=stripe.webhooks.constructEvent('','','');db.subscription.update(e.data.object.current_period_end_extra);}`);
  const b=await resolve(input);assert.equal(b.affectedSites.length,0);assert.equal(db(b).length,1);
});
test('L2 ES module JavaScript fallback shares property and sink analysis',async t=>{
  const input=await setup(t,'handler','fallback.js');await fs.writeFile(path.join(input.repositoryRoot,'fallback.js'),`import Stripe from 'stripe';import {db as storage} from './db';const stripe=new Stripe('inert');export function handler(){const event=stripe.webhooks.constructEvent('','','');const value=event.data.object['current_period_end'];storage.subscription.update({value});}`);
  const b=await resolve(input);assert.equal(db(b).length,1);assert.equal(b.affectedSites[0].provenance.confidence,'medium');
});
test('L2 checker uses the customer tsconfig and provider-declared local type',async t=>{
  const input=await setup(t,'handler','typed-local.ts');
  await fs.writeFile(path.join(input.repositoryRoot,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,module:'CommonJS',moduleResolution:'Node',esModuleInterop:true,baseUrl:'.',paths:{'@storage':['db.ts']}}}));
  await fs.writeFile(path.join(input.repositoryRoot,'typed-local.ts'),`import Stripe from 'stripe';import {db} from '@storage';export function handler(input: unknown){const event:Stripe.Event=input as Stripe.Event;db.subscription.update((event.data.object as any).current_period_end);}`);
  const b=await resolve(input);assert.equal(db(b).length,1);assert.equal(b.affectedSites[0].provenance.basis,'provider_type');assert.equal(b.affectedSites[0].provenance.confidence,'high');
});
test('L2 excludes generated directories and diagnoses loops without unbounded traversal',async t=>{
  const input=await setup(t,'handler','loop.ts');
  await fs.mkdir(path.join(input.repositoryRoot,'dist'));await fs.writeFile(path.join(input.repositoryRoot,'dist/generated.ts'),'export const x=1;');
  await fs.writeFile(path.join(input.repositoryRoot,'loop.ts'),`import './dist/generated';import Stripe from 'stripe';import {db} from './db';const stripe=new Stripe('inert');export function handler(){const e=stripe.webhooks.constructEvent('','','');let value=e.data.object.current_period_end;while(value>0){value=value-1;}db.subscription.update(value);}`);
  const b=await resolve(input);assert.ok(b.skipped.some(d=>d.reason==='loop_bound:one_iteration_join'));assert.ok(b.skipped.some(d=>d.reason.startsWith('unresolved_or_ignored_import')));assert.ok(b.nodes.every(n=>!n.location.file.startsWith('dist/')));assert.ok(b.nodes.length<30);
});
test('L2 different calls into one helper retain distinct call contexts',async t=>{
  const input=await setup(t,'handler','contexts.ts');await fs.writeFile(path.join(input.repositoryRoot,'contexts.ts'),`import Stripe from 'stripe';import {db} from './db';const stripe=new Stripe('inert');function persist(value){db.subscription.update(value);}export function handler(){const e=stripe.webhooks.constructEvent('','','');persist(e.data.object.current_period_end);persist(e.data.object.items.data[0].current_period_end);}`);
  const b=await resolve(input);assert.equal(db(b).length,2);assert.equal(new Set(db(b).map(s=>s.nodeId)).size,2);assert.ok(b.affectedSites.every(s=>s.sinkNodeIds.length===1));
});
test('L2 anonymous default-exported function is a configured entry',async t=>{
  const input=await setup(t,'default','default.ts');await fs.writeFile(path.join(input.repositoryRoot,'default.ts'),`import Stripe from 'stripe';const stripe=new Stripe('inert');export default function(){const event=stripe.webhooks.constructEvent('','','');return event.data.object.current_period_end;}`);
  const b=await resolve(input);assert.equal(b.sinks[0].kind,'returned_state');assert.equal(b.affectedSites.length,1);
});
test('L2 constructed-object fields cross helper bindings at medium confidence', async t => {
  const input=await setup(t,'handler','object-hop.ts');await fs.writeFile(path.join(input.repositoryRoot,'object-hop.ts'),`import Stripe from 'stripe';import {db} from './db';const stripe=new Stripe('inert');function persist(arg){db.subscription.update(arg.nested.value);}export function handler(){const event=stripe.webhooks.constructEvent('','','');const arg={nested:{value:event.data.object.current_period_end}};persist(arg);}`);
  const b=await resolve(input);assert.equal(db(b).length,1);assert.equal(node(b,db(b)[0].nodeId).provenance.confidence,'medium');
  const ancestors=new Set([db(b)[0].nodeId]);for(let i=0;i<b.nodes.length;i++)for(const e of b.edges)if(ancestors.has(e.to))ancestors.add(e.from);
  assert.ok(b.nodes.some(n=>ancestors.has(n.id)&&n.kind==='local_call'));
});
test('L2 helper lookup uses its lexical scope, not caller-local shadowing',async t=>{
  const input=await setup(t,'handler','lexical.ts');await fs.writeFile(path.join(input.repositoryRoot,'lexical.ts'),`import Stripe from 'stripe';import {db} from './db';const stripe=new Stripe('inert');function persist(value){db.subscription.update(value);}export function handler(){const event=stripe.webhooks.constructEvent('','','');const db={subscription:{update:()=>{}}};persist(event.data.object.current_period_end);}`);
  const b=await resolve(input);assert.equal(db(b).length,1);assert.equal(node(b,db(b)[0].nodeId).provenance.confidence,'medium');
});
test('L2 an untainted constructed-object sibling does not inherit provider taint',async t=>{
  const input=await setup(t,'handler','sibling.ts');await fs.writeFile(path.join(input.repositoryRoot,'sibling.ts'),`import Stripe from 'stripe';import {db} from './db';const stripe=new Stripe('inert');export function handler(){const event=stripe.webhooks.constructEvent('','','');const object={value:event.data.object.current_period_end,clean:123};db.subscription.update(object.clean);db.subscription.update(object.missing);}`);
  const b=await resolve(input);assert.equal(db(b).length,0);assert.ok(b.affectedSites.length);
});
for (const conditional of ['flag ? value=123 : 0','flag && (value=123)']) test(`L2 conditional assignments conservatively join: ${conditional}`,async t=>{
  const input=await setup(t,'handler','conditional.ts');await fs.writeFile(path.join(input.repositoryRoot,'conditional.ts'),`import Stripe from 'stripe';import {db} from './db';const stripe=new Stripe('inert');export function handler(flag){const event=stripe.webhooks.constructEvent('','','');let value=event.data.object.current_period_end;${conditional};db.subscription.update(value);}`);
  const b=await resolve(input);assert.equal(db(b).length,1);assert.ok(b.affectedSites.some(s=>s.sinkNodeIds.includes(db(b)[0].nodeId)));
});
test('L2 passing a provider client through a helper cannot create high-confidence roots',async t=>{
  const input=await setup(t,'handler','client-hop.ts');await fs.writeFile(path.join(input.repositoryRoot,'client-hop.ts'),`import Stripe from 'stripe';import {db} from './db';const stripe=new Stripe('inert');function persist(client){const event=client.webhooks.constructEvent('','','');db.subscription.update(event.data.object.current_period_end);}export function handler(){persist(stripe);}`);
  const b=await resolve(input);assert.equal(db(b).length,1);assert.ok(b.affectedSites.every(s=>s.provenance.confidence==='medium'));
});
test('L2 TypeScript CommonJS uses explicit import provenance at high confidence',async t=>{
  const input=await setup(t,'handler','common.ts');await fs.copyFile(path.join(input.repositoryRoot,'common.cjs'),path.join(input.repositoryRoot,'common.ts'));
  const b=await resolve(input);assert.equal(db(b).length,1);assert.ok(b.affectedSites.every(s=>s.provenance.confidence==='high'));
});
test('L2 mutual recursion obeys the one-hop cutoff',async t=>{
  const input=await setup(t,'handler','mutual.ts');await fs.writeFile(path.join(input.repositoryRoot,'mutual.ts'),`import Stripe from 'stripe';const stripe=new Stripe('inert');function first(v){second(v);}function second(v){first(v);}export function handler(){const e=stripe.webhooks.constructEvent('','','');first(e.data.object.current_period_end);}`);
  const b=await resolve(input);assert.ok(b.skipped.some(d=>d.reason==='local_call_limit:1'));assert.ok(b.nodes.length<20);
});
test('L2 Math.min and sort preserve aggregation evidence',async t=>{
  const input=await setup(t,'handler','minimum.ts');await fs.writeFile(path.join(input.repositoryRoot,'minimum.ts'),`import Stripe from 'stripe';import {db} from './db';const stripe=new Stripe('inert');export function handler(){const event=stripe.webhooks.constructEvent('','','');const periods=event.data.object.items.data.map(({current_period_end:period})=>period).sort();db.subscription.update(Math.min(...periods));}`);
  const b=await resolve(input);assert.equal(db(b).length,1);assert.ok(b.nodes.some(n=>n.label==='Math.min'&&n.aggregation));assert.ok(b.nodes.some(n=>n.label==='sort'&&n.aggregation));assert.ok(b.affectedSites.some(s=>s.sinkNodeIds.includes(db(b)[0].nodeId)));
});
