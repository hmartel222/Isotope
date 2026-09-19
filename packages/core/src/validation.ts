import Ajv, { type ValidateFunction } from 'ajv';
import { schemas, JsonValueSchema, type ContractName, type Contract } from './contracts';

const ajv = new Ajv({ allErrors: true, strict: true });
ajv.addSchema(JsonValueSchema);
const validators = new Map<ContractName, ValidateFunction>();
export class ArtifactValidationError extends Error {
  constructor(readonly contract: string, readonly issues: readonly string[]) {
    super(`Invalid ${contract}: ${issues.join('; ')}`);
    this.name = 'ArtifactValidationError';
  }
}

/** No coercion, default insertion, removal of fields, or other input mutation. */
export function validateContract<N extends ContractName>(name: N, value: unknown): Contract<N> {
  let validate = validators.get(name);
  if (!validate) { validate = ajv.compile(schemas[name]); validators.set(name, validate); }
  if (!validate(value)) {
    throw new ArtifactValidationError(name, (validate.errors ?? []).map(e => `${e.instancePath || '/'} ${e.message} ${JSON.stringify(e.params)}`));
  }
  const issues: string[] = [];
  // Cross-field invariants cannot be represented in portable JSON Schema.
  if (name === 'RepairVerification') checkVerification(value as Contract<'RepairVerification'>, issues);
  if (name === 'VerifiedRepair') checkVerified(value as Contract<'VerifiedRepair'>, issues);
  if (name === 'RepairPacket') {
    const packet = value as Contract<'RepairPacket'>;
    if (packet.execution.baselineSignature.fixturePair !== packet.execution.newSignature.fixturePair) issues.push('/execution signatures must use the same planning fixture pair');
  }
  if (name === 'ChangeSpec') {
    const spec = value as Contract<'ChangeSpec'>;
    if (spec.verified_by === 'human' && !spec.verified_at) issues.push('/verified_at is required for human verification');
  }
  if (name === 'IsotopeReport') {
    const report = value as Contract<'IsotopeReport'>;
    report.repairVerifications.forEach(v => checkVerification(v, issues));
    report.verifiedRepairs.forEach(v => checkVerified(v, issues));
  }
  if (issues.length) throw new ArtifactValidationError(name, issues);
  return value as Contract<N>;
}

function checkVerification(v: Contract<'RepairVerification'>, issues: string[]): void {
  for (const [role, pair] of [['planning', v.planning], ['held_out', v.heldOut]] as const) {
    if (!pair) continue;
    if (pair.role !== role) issues.push(`/${role}/role must be ${role}`);
    if (pair.verdict.entryPointId !== v.entryPointId) issues.push(`/${role}/verdict entryPointId mismatch`);
    for (const ref of [pair.baseline, ...pair.patchedOld, ...pair.patchedNew]) {
      if (ref.fixturePair !== pair.fixturePair) issues.push(`/${role} signature fixturePair mismatch`);
    }
    for (const ref of [...pair.patchedOld, ...pair.patchedNew]) {
      if (ref.codeVersion !== `patched:${v.repairId}`) issues.push(`/${role} patched signatures must identify patched:${v.repairId}`);
    }
    for (const runs of [pair.patchedOld, pair.patchedNew]) {
      if (new Set(runs.map(r => r.runIndex)).size !== runs.length) issues.push(`/${role} duplicate runIndex`);
      if (new Set(runs.map(r => r.payloadVersion)).size !== 1) issues.push(`/${role} self-comparison must use the same payload version`);
    }
  }
  if (v.planning && v.heldOut && v.planning.fixturePair === v.heldOut.fixturePair) issues.push('/heldOut must be a distinct fixture pair');
  if (v.outcome === 'verified') {
    for (const pair of [v.planning, v.heldOut]) {
      if (!pair || !pair.stable || !pair.baselineEquivalent || !pair.secondaryStable || !['PASS', 'PASS_REASONED'].includes(pair.verdict.verdict)) issues.push('/outcome verified requires successful planning and held-out evidence');
    }
    if (!v.shapeChecks || !Object.values(v.shapeChecks).every(Boolean)) issues.push('/shapeChecks must all pass for verified');
  }
}
function checkVerified(v: Contract<'VerifiedRepair'>, issues: string[]): void {
  checkVerification(v.verification, issues);
  for (const field of ['repairId', 'entryPointId', 'specId'] as const) if (v[field] !== v.verification[field]) issues.push(`/${field} must match verification`);
  if (v.candidate.origin !== v.verification.origin) issues.push('/candidate/origin must match verification');
}

/** Validate the cross-artifact prerequisite without implementing selection or repair. */
export function validateRepairPrerequisites(config: Contract<'IsotopeConfig'>, selected: Contract<'SelectedSpecs'>): void {
  validateContract('IsotopeConfig', config);
  validateContract('SelectedSpecs', selected);
  if (config.repair.mode === 'on') for (const spec of selected.specs) {
    if (!spec.fixtures.heldout_pair || spec.fixtures.heldout_pair === spec.fixtures.pair) {
      throw new ArtifactValidationError('SelectedSpecs', [`spec ${spec.id}: repair requires a distinct fixtures.heldout_pair`]);
    }
  }
}
