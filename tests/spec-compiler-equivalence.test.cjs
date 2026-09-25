const test = require('node:test');
const assert = require('node:assert/strict');

async function compare(golden, compiled) { return (await import('../tools/compare-changespec-runs.mjs')).compareArtifacts('test', golden, compiled); }
const spec = { id: 'golden', source: 'provider', verified_at: '2026-01-01', detection: { taint_roots: [{ pattern: '$SDK.call($$$)' }] }, changes: [{ removed_path: 'old', replacement: { path: 'new', cardinality: 'one' } }], fixtures: { pair: 'pair' } };
const run = value => ({ 'selected-specs.json': { specs: [value] }, 'bdg.json': { nodes: [{ provenance: { specId: value.id }, path: 'old' }] }, 'verdict.json': { verdict: 'FAIL' }, 'signature.json': { durationMs: 4, returned: { ok: true } } });

test('equivalence normalizes only explicit identity and timing fields', async () => {
  const compiled = structuredClone(spec); compiled.id = 'compiled.hash'; compiled.source = 'snapshot'; compiled.verified_at = '2026-09-22';
  assert.equal((await compare(run(spec), run(compiled))).equivalent, true);
});
for (const [name, mutate] of [
  ['taint root', value => { value.detection.taint_roots[0].pattern = '$SDK.other($$$)'; }],
  ['replacement path', value => { value.changes[0].replacement.path = 'other'; }],
  ['cardinality', value => { value.changes[0].replacement.cardinality = 'many'; }],
  ['fixture pair', value => { value.fixtures.pair = 'other'; }],
]) test(`equivalence rejects changed ${name}`, async () => { const changed = structuredClone(spec); mutate(changed); const report = await compare(run(spec), run(changed)); assert.equal(report.equivalent, false); assert.ok(report.unexpectedDifferences.length); });
