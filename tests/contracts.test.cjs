const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
const core = require('@isotope/core');
const { fixtures, clone } = require('./fixtures/contracts.cjs');

test('every registered contract has a representative fixture', () => assert.deepEqual(Object.keys(fixtures).sort(), Object.keys(core.schemas).sort()));
for (const [name, fixture] of Object.entries(fixtures)) test(`${name}: representative fixture validates without mutation`, () => {
  const before = clone(fixture);
  assert.equal(core.validateContract(name, fixture), fixture);
  assert.deepEqual(fixture, before);
});
const invalid = [
  ['Verdict', () => 'OK', '/'],
  ['Signature', v => { delete v.entryPointId; return v; }, 'entryPointId'],
  ['Signature', v => { delete v.calls[0].seq; return v; }, 'seq'],
  ['Signature', v => ({ ...v, codeVersion: 'patched:' }), 'codeVersion'],
  ['Signature', v => ({ ...v, runIndex: -1 }), 'runIndex'],
  ['ReasoningResult', v => ({ ...v, confidence: 'certain' }), 'confidence'],
  ['CandidatePatch', v => { v.patch.files[0].edits = [{ replacement: 'x' }]; return v; }, 'anchor'],
  ['CandidatePatch', v => ({ ...v, classification: 'verified' }), 'classification'],
  ['CandidatePatch', v => { v.patch.files[0].edits[0].anchor = ''; return v; }, 'anchor'],
  ['CandidatePatch', v => ({ ...v, patch: null }), 'patch'],
  ['IsotopeConfig', v => ({ ...v, language: 'ruby' }), 'language'],
  ['IsotopeConfig', v => { v.repair.verify = false; return v; }, 'verify'],
  ['IsotopeConfig', v => { v.repair.mode = 'off'; v.repair.verify = false; return v; }, 'verify'],
  ['IsotopeConfig', v => { v.repair.maxAttempts = 2; return v; }, 'maxAttempts'],
  ['IsotopeConfig', v => { v.repair.maxFiles = 4; return v; }, 'maxFiles'],
  ['IsotopeConfig', v => { v.repair.maxChangedLines = 81; return v; }, 'maxChangedLines'],
  ['SelectedSpecs', v => { v.specs[0].verified_by = 'draft'; return v; }, 'verified_by'],
  ['ChangeSpec', v => { delete v.verified_at; return v; }, 'verified_at'],
  ['RepairPacket', v => ({ ...v, heldOut: { payload: 'forbidden' } }), 'heldOut'],
  ['RepairPacket', v => { v.execution.newSignature.fixturePair = 'other'; return v; }, 'planning'],
  ['RepairVerification', v => ({ ...v, heldOut: null }), 'heldOut'],
  ['RepairVerification', v => { v.heldOut.fixturePair = v.planning.fixturePair; return v; }, 'fixture'],
  ['RepairVerification', v => { v.planning.patchedNew[0].codeVersion = 'original'; return v; }, 'patched:r1'],
  ['RepairVerification', v => { v.planning.patchedNew[1].runIndex = 0; return v; }, 'runIndex'],
  ['RepairVerification', v => { v.heldOut.verdict.verdict = 'FAIL'; return v; }, 'heldOut'],
  ['RepairVerification', v => { v.shapeChecks.sinksPreserved = false; return v; }, 'shapeChecks'],
  ['VerifiedRepair', v => { v.verification.outcome = 'overfit_rejected'; return v; }, 'outcome'],
  ['VerifiedRepair', v => { v.candidate.suspectedInjection = true; return v; }, 'candidate'],
  ['VerifiedRepair', v => ({ ...v, repairId: 'wrong' }), 'repairId'],
  ['IsotopeReport', v => { v.verifiedRepairs[0].verification.heldOut = null; return v; }, 'heldOut'],
];
for (const [name, mutate, error] of invalid) test(`${name}: rejects ${error} malformed example`, () => assert.throws(() => core.validateContract(name, mutate(clone(fixtures[name]))), e => e instanceof core.ArtifactValidationError && e.message.includes(error)));
test('all v3 verdicts, divergence kinds, origins and rejection outcomes are representable', () => {
  for (const verdict of ['PASS','PASS_REASONED','FAIL','FAIL_REASONED','ESCALATE','INDETERMINATE','SKIP']) core.validateContract('Verdict', verdict);
  for (const kind of ['identical','value_to_missing','call_dropped','threw_new_only','value_changed','type_changed','call_added','call_args_changed','field_added','unstable']) core.validateContract('Divergence', { ...fixtures.Divergence, kind });
  for (const origin of ['deterministic','model']) core.validateContract('CandidatePatch', { ...fixtures.CandidatePatch, origin });
  for (const outcome of ['overfit_rejected','did_not_restore_behavior','ambiguity_after_patch','patch_introduced_nondeterminism','patch_invalid','degenerate_patch']) core.validateContract('RepairVerification', { ...fixtures.RepairVerification, outcome, planning: null, heldOut: null, shapeChecks: null });
  for (const classification of ['human_decision_required', 'no_safe_repair']) core.validateContract('CandidatePatch', { ...fixtures.CandidatePatch, classification, patch: null, humanQuestion: 'Which policy?' });
});
test('repair prerequisites require human-verified specs and distinct held-out pairs', () => {
  core.validateRepairPrerequisites(fixtures.IsotopeConfig, fixtures.SelectedSpecs);
  const selected = clone(fixtures.SelectedSpecs);
  delete selected.specs[0].fixtures.heldout_pair;
  assert.throws(() => core.validateRepairPrerequisites(fixtures.IsotopeConfig, selected), /heldout_pair/);
  const config = clone(fixtures.IsotopeConfig); config.repair.mode = 'off';
  core.validateRepairPrerequisites(config, selected);
});
test('generated JSON Schema is portable and accepts representative fixtures', () => {
  const Ajv = require('../packages/core/node_modules/ajv');
  for (const [name, fixture] of Object.entries(fixtures)) {
    const file = name === 'ChangeSpec' ? 'changespec' : name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
    const schema = JSON.parse(readFileSync(path.join(__dirname, `../packages/core/schemas/${file}.schema.json`), 'utf8'));
    const validate = new Ajv({ strict: true }).compile(schema);
    assert.ok(validate(fixture), `${name}: ${JSON.stringify(validate.errors)}`);
  }
});
