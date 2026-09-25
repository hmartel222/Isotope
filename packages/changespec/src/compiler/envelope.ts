import { canonicalHash, validateContract, type ChangeSpec, type ChangeSpecEnvelope, type DependencyBinding, type EvidenceBinding } from '@isotope/core';
import { createFixtureEvidenceBinding } from '@isotope/fixtures';
import { lowerEnvelope } from './lower';
import { evaluateApprovalReadiness } from './approval';

export function rehashEnvelope(value: Omit<ChangeSpecEnvelope, 'bundleHash'> | ChangeSpecEnvelope): ChangeSpecEnvelope {
  const withoutHash = { ...value, bundleHash: undefined };
  return { ...value, bundleHash: canonicalHash(withoutHash) } as ChangeSpecEnvelope;
}

export async function createEvidenceBinding(input: { fixturesRoot: string; pair: string; heldoutPair?: string; dependencyBinding: DependencyBinding; mode?: 'product'|'internal-test' }): Promise<EvidenceBinding> {
  return createFixtureEvidenceBinding({ ...input, mode: input.mode ?? 'product' });
}

export function bindEnvelopeEvidence(envelope: ChangeSpecEnvelope, binding: EvidenceBinding): ChangeSpecEnvelope {
  if (envelope.status === 'approved') throw new Error('Approved envelopes are immutable');
  const { approval: _approval, runtimeSpec: _runtimeSpec, bundleHash: _bundleHash, ...rest } = envelope;
  return validateContract('ChangeSpecEnvelope', rehashEnvelope({ ...rest, status: 'validated', evidenceBinding: binding }));
}

export interface ApproveEnvelopeInput { envelope: ChangeSpecEnvelope; report: import('@isotope/core').ChangeSpecCompilationReport; actor: string; approvedAt?: string; policyVersion?: string }
export function approveEnvelope(input: ApproveEnvelopeInput): ChangeSpecEnvelope {
  const { envelope, report, actor } = input;
  const approvedAt = input.approvedAt ?? new Date().toISOString(); const policyVersion = input.policyVersion ?? '1';
  if (envelope.status === 'approved' || envelope.status === 'revoked') throw new Error(`Cannot approve envelope in ${envelope.status} state`);
  const readiness = evaluateApprovalReadiness(envelope, report);
  if (!readiness.ready) throw new Error(`Approval blocked:\n- ${readiness.blockers.join('\n- ')}`);
  const approval = { actor, approvedAt, candidateHash: canonicalHash(envelope.candidate), sourceHash: canonicalHash(envelope.sourceProvenance), evidenceHash: canonicalHash(envelope.evidenceBinding), compilationReportHash: canonicalHash(report), policyVersion };
  const { runtimeSpec: _runtimeSpec, bundleHash: _bundleHash, ...rest } = envelope;
  const base = { ...rest, status: 'approved' as const, approval };
  const runtimeSpec: ChangeSpec = lowerEnvelope(base as unknown as ChangeSpecEnvelope);
  return validateContract('ChangeSpecEnvelope', rehashEnvelope({ ...base, runtimeSpec }));
}

export function revokeEnvelope(envelope: ChangeSpecEnvelope): ChangeSpecEnvelope {
  if (envelope.status !== 'approved') throw new Error('Only approved envelopes can be revoked');
  const { runtimeSpec: _runtimeSpec, bundleHash: _bundleHash, ...rest } = envelope;
  return validateContract('ChangeSpecEnvelope', rehashEnvelope({ ...rest, status: 'revoked' }));
}
