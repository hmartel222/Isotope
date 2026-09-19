const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const core = require('@isotope/core');
const { fixtures, clone } = require('./fixtures/contracts.cjs');

async function temporary(t) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'isotope-contracts-')));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
test('all contracts round-trip through validated UTF-8 JSON in a temporary directory', async t => {
  const dir = await temporary(t);
  const paths = core.artifactPaths(dir);
  await core.ensureArtifactDirectories(dir);
  for (const [name, fixture] of Object.entries(fixtures)) {
    const file = paths.proposal(name);
    await core.writeJsonArtifact(paths.root, file, name, fixture);
    assert.deepEqual(await core.readJsonArtifact(paths.root, file, name), fixture);
    assert.equal(await fs.readFile(file, 'utf8'), core.deterministicJson(fixture));
  }
});
test('deterministic JSON sorts object keys recursively and preserves array order and unicode', () => {
  assert.equal(core.deterministicJson({ b: { z: 'é', a: 1 }, a: [2, 1] }), core.deterministicJson({ a: [2, 1], b: { a: 1, z: 'é' } }));
  assert.deepEqual(JSON.parse(core.deterministicJson({ a: [2, 1] })).a, [2, 1]);
  for (const value of [undefined, { a: undefined }, NaN, Infinity, new Date(), [,,1], () => {}, 1n]) assert.throws(() => core.deterministicJson(value));
  const circular = {}; circular.self = circular; assert.throws(() => core.deterministicJson(circular), /cycle/);
});
test('invalid writes leave an existing file intact and invalid reads explain contract/path', async t => {
  const dir = await temporary(t); const p = core.artifactPaths(dir);
  await core.writeJsonArtifact(p.root, p.verdict, 'VerdictReport', fixtures.VerdictReport);
  const before = await fs.readFile(p.verdict, 'utf8');
  await assert.rejects(core.writeJsonArtifact(p.root, p.verdict, 'VerdictReport', { ...fixtures.VerdictReport, verdict: 'NOT_REAL' }), /VerdictReport.*verdict/);
  assert.equal(await fs.readFile(p.verdict, 'utf8'), before);
  await fs.writeFile(p.verdict, '{bad');
  await assert.rejects(core.readJsonArtifact(p.root, p.verdict, 'VerdictReport'), /Cannot read VerdictReport artifact/);
  await fs.writeFile(p.verdict, '{"verdict":"NOT_REAL"}');
  await assert.rejects(core.readJsonArtifact(p.root, p.verdict, 'VerdictReport'), /Invalid VerdictReport/);
});
test('paths cover the chain and keep signature versions, pairs, runs and reasoning votes distinct', () => {
  const p = core.artifactPaths('/repo');
  assert.equal(p.selectedSpecs, '/repo/.isotope/selected-specs.json');
  assert.equal(p.bdg, '/repo/.isotope/bdg.json');
  assert.equal(p.diffReport, '/repo/.isotope/diff-report.json');
  assert.equal(p.verdict, '/repo/.isotope/verdict.json');
  assert.equal(p.report, '/repo/.isotope/isotope-report.json');
  assert.equal(p.evidencePacket('ep','d'), '/repo/.isotope/evidence-packets/ep.d.json');
  assert.equal(p.reasoning('ep','d'), '/repo/.isotope/reasoning/ep.d.0.json');
  assert.equal(p.repairPacket('r1'), '/repo/.isotope/repair/packets/r1.json');
  assert.equal(p.candidate('r1'), '/repo/.isotope/repair/candidates/r1.json');
  assert.equal(p.proposal('r1'), '/repo/.isotope/repair/proposals/r1.json');
  assert.equal(p.verification('r1'), '/repo/.isotope/repair/verification/r1.json');
  assert.equal(p.verifiedRepair, '/repo/.isotope/repair/verified-repair.json');
  assert.equal(p.cache('abc'), '/repo/.isotope/cache/abc.json');
  const paths = new Set();
  for (const codeVersion of ['original', 'patched:r1']) for (const fixturePair of ['planning', 'heldout']) for (const payloadVersion of ['old', 'new']) for (const runIndex of [0, 1]) paths.add(p.signature({ entryPointId: 'ep', codeVersion, fixturePair, payloadVersion, runIndex }));
  assert.equal(paths.size, 16);
  assert.equal(p.signature({ entryPointId: 'ep', codeVersion: 'original', fixturePair: 'planning', payloadVersion: 'old', runIndex: 0 }), '/repo/.isotope/signatures/original/planning/ep.old.0.json');
  assert.notEqual(p.evidencePacket('a.b','c'), p.evidencePacket('a','b.c'));
  assert.notEqual(p.reasoning('ep','d',0), p.reasoning('ep','d',1));
});
test('path helpers reject traversal and invalid run indices', () => {
  const p = core.artifactPaths('/repo');
  for (const id of ['', '.', '..', '../outside', '/outside', '..\\outside', 'a\0b']) {
    for (const fn of [p.proposal, p.repairPacket, p.verification, id => p.evidencePacket(id,'d'), id => p.reasoning('ep',id)]) assert.throws(() => fn(id), /Unsafe artifact identifier/);
  }
  for (const runIndex of [-1, 0.5, NaN, Infinity]) assert.throws(() => p.signature({ ...fixtures.Signature, runIndex }), /runIndex/);
  for (const location of ['/repo/outside', '/repo/.isotope/../outside', '/repo/.isotope-other/x', '/repo/.isotope']) assert.throws(() => core.assertWithinRoot(p.root, location), /below/);
});
test('I/O rejects lexical escape and symlinked parents or files', async t => {
  const dir = await temporary(t); const p = core.artifactPaths(dir);
  await core.ensureArtifactDirectories(dir);
  const outside = path.join(dir, 'outside'); await fs.mkdir(outside);
  await assert.rejects(core.writeJsonArtifact(p.root, path.join(outside,'x'), 'Verdict', 'PASS'), /below/);
  await fs.symlink(outside, path.join(p.root,'escape'));
  await assert.rejects(core.writeJsonArtifact(p.root, path.join(p.root,'escape','x.json'), 'Verdict', 'PASS'), /symlink/);
  const external = path.join(outside,'external.json'); await fs.writeFile(external, '"FAIL"');
  await fs.symlink(external, p.verdict);
  await assert.rejects(core.readJsonArtifact(p.root, p.verdict, 'Verdict'), /symlink/);
  await assert.rejects(core.writeJsonArtifact(p.root, p.verdict, 'Verdict', 'PASS'), /symlink/);
  assert.equal(await fs.readFile(external, 'utf8'), '"FAIL"');
});

test('stale-artifact removal rejects escapes and symlinks', async t => {
  const dir = await temporary(t); const p = core.artifactPaths(dir);
  await core.writeJsonArtifact(p.root,p.verdict,'Verdict','PASS');
  await core.removeJsonArtifact(p.root,p.verdict);
  await assert.rejects(fs.access(p.verdict), {code:'ENOENT'});
  await core.removeJsonArtifact(p.root,p.verdict);
  const outside=path.join(dir,'outside.json'); await fs.writeFile(outside,'keep');
  await fs.symlink(outside,p.verdict);
  await assert.rejects(core.removeJsonArtifact(p.root,p.verdict),/symlink/);
  await assert.rejects(core.removeJsonArtifact(p.root,outside),/below/);
  assert.equal(await fs.readFile(outside,'utf8'),'keep');
});
