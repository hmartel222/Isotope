import Ajv, { type ValidateFunction } from 'ajv';
import { createHash } from 'node:crypto';
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
    spec.changes.forEach((change, index) => {
      if (!change.removed_path && !change.removed_symbol) issues.push(`/changes/${index} requires removed_path or removed_symbol`);
    });
  }
  if (name === 'ChangeSpecCandidate') checkCandidate(value as Contract<'ChangeSpecCandidate'>, issues);
  if (name === 'ChangeSpecInputPacket') {
    const packet = value as Contract<'ChangeSpecInputPacket'>;
    const expected = canonicalHash({ ...packet, inputHash: undefined });
    if (packet.inputHash !== expected) issues.push('/inputHash does not match normalized packet content');
    for (const source of packet.sources) if (createHash('sha256').update(source.content).digest('hex') !== source.sha256) issues.push(`/sources/${source.id}/sha256 does not match content`);
  }
  if (name === 'ChangeSpecEnvelope') checkEnvelope(value as Contract<'ChangeSpecEnvelope'>, issues);
  if (name === 'EvidenceBinding') checkEvidenceBinding(value as Contract<'EvidenceBinding'>, issues);
  if (name === 'IsotopeReport') {
    const report = value as Contract<'IsotopeReport'>;
    report.repairVerifications.forEach(v => checkVerification(v, issues));
    report.verifiedRepairs.forEach(v => checkVerified(v, issues));
  }
  if (issues.length) throw new ArtifactValidationError(name, issues);
  return value as Contract<N>;
}

function canonical(value: unknown): string {
  if (value === undefined) return '';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}
export function canonicalHash(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }

function pathKey(path: Contract<'ChangeSpecCandidate'>['changes'][number]['replacement']['path']): string {
  return path.segments.map(segment => segment.kind === 'wildcard' ? '*' : segment.name).join('.');
}
function checkCandidate(candidate: Contract<'ChangeSpecCandidate'>, issues: string[]): void {
  candidate.changes.forEach((change, index) => {
    if (!change.removedPath && !change.removedSymbol) issues.push(`/changes/${index} requires removedPath or removedSymbol`);
    if (change.removedPath && pathKey(change.removedPath) === pathKey(change.replacement.path)) issues.push(`/changes/${index} removed and replacement paths must differ`);
    if (change.appliesToEvents?.length && !change.citations.events?.length) issues.push(`/changes/${index}/citations/events required for event restrictions`);
  });
}
function checkEnvelope(envelope: Contract<'ChangeSpecEnvelope'>, issues: string[]): void {
  checkCandidate(envelope.candidate, issues);
  const candidateHash = canonicalHash(envelope.candidate);
  const sourceIds = new Set(envelope.sourceProvenance.sources.map(source => source.id));
  const citations = [envelope.candidate.semanticsCitations, ...envelope.candidate.changes.flatMap(change => [change.citations.removed, change.citations.replacement, change.citations.events ?? []])].flat();
  for (const citation of citations) if (!sourceIds.has(citation.sourceId)) issues.push(`/candidate citation references unknown source ${citation.sourceId}`);
  const dependency = envelope.dependencyBinding;
  if (envelope.candidate.dependencyProposal.ecosystem !== dependency.ecosystem || envelope.candidate.dependencyProposal.package !== dependency.package) issues.push('/candidate dependency proposal must match authoritative dependency binding');
  if (envelope.candidate.describedVersions.from !== dependency.fromVersion || envelope.candidate.describedVersions.to !== dependency.toVersion) issues.push('/candidate versions must match authoritative dependency binding');
  if (envelope.approval && envelope.approval.candidateHash !== candidateHash) issues.push('/approval/candidateHash does not match candidate');
  if (envelope.approval && envelope.approval.sourceHash !== canonicalHash(envelope.sourceProvenance)) issues.push('/approval/sourceHash does not match source provenance');
  if (envelope.approval && envelope.approval.evidenceHash !== canonicalHash(envelope.evidenceBinding)) issues.push('/approval/evidenceHash does not match evidence binding');
  if (envelope.approval && envelope.approval.compilationReportHash !== envelope.compilerProvenance.compilationReportHash) issues.push('/approval/compilationReportHash does not match compiler provenance');
  if (envelope.status === 'approved') {
    if (!envelope.approval) issues.push('/approval is required for approved status');
    if (!envelope.runtimeSpec) issues.push('/runtimeSpec is required for approved status');
    if (envelope.projectBinding.status !== 'bound') issues.push('/projectBinding must be bound for approved status');
    if (envelope.evidenceBinding.status !== 'bound') issues.push('/evidenceBinding must be bound for approved status');
    checkEvidenceBinding(envelope.evidenceBinding, issues);
    if (envelope.candidate.unknowns.length) issues.push('/candidate/unknowns must be empty for approved status');
    if (envelope.candidate.unsupportedFeatures.length) issues.push('/candidate/unsupportedFeatures must be empty for approved status');
    if (envelope.candidate.abstain) issues.push('/candidate/abstain must be false for approved status');
    if (envelope.candidate.suspectedInjection) issues.push('/candidate/suspectedInjection must be false for approved status');
  }
  if (envelope.status !== 'approved' && envelope.runtimeSpec) issues.push('/runtimeSpec is only permitted for approved status');
  const expectedBundleHash = canonicalHash({ ...envelope, bundleHash: undefined });
  if (envelope.bundleHash !== expectedBundleHash) issues.push('/bundleHash does not match envelope content');
}
function checkEvidenceBinding(binding: Contract<'EvidenceBinding'>, issues: string[]): void {
  if (binding.status !== 'bound') return;
  if (!binding.pair) issues.push('/evidenceBinding/pair is required when bound');
  if (!binding.oldVersion || !binding.newVersion) issues.push('/evidenceBinding oldVersion and newVersion are required when bound');
  if (!binding.provenance) issues.push('/evidenceBinding/provenance is required when bound');
  if (binding.synthetic === undefined) issues.push('/evidenceBinding/synthetic is required when bound');
  if (binding.heldoutPair && binding.heldoutPair === binding.pair) issues.push('/evidenceBinding heldoutPair must differ from pair');
  for (const pair of [binding.pair, binding.heldoutPair]) for (const file of ['old.json', 'new.json', 'meta.json']) {
    if (pair && !binding.fixtureHashes[`${pair}/${file}`]) issues.push(`/evidenceBinding missing hash for ${pair}/${file}`);
  }
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
