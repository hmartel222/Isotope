import { canonicalHash, validateContract, type ChangeSpecCompilationReport, type ChangeSpecEnvelope } from '@isotope/core';

export interface ApprovalReadiness { ready: boolean; blockers: string[]; warnings: string[] }

export function evaluateApprovalReadiness(envelope: ChangeSpecEnvelope, report?: ChangeSpecCompilationReport): ApprovalReadiness {
  const blockers: string[] = [];
  const warnings: string[] = [];
  try { validateContract('ChangeSpecEnvelope', envelope); } catch (error) { blockers.push(error instanceof Error ? error.message : String(error)); }
  if (envelope.candidate.abstain) blockers.push('candidate abstained');
  if (envelope.candidate.suspectedInjection) blockers.push('candidate or source is injection-suspected');
  if (envelope.candidate.unknowns.length) blockers.push(`candidate has unresolved unknowns: ${envelope.candidate.unknowns.join('; ')}`);
  if (envelope.candidate.unsupportedFeatures.length) blockers.push(`candidate has unsupported features: ${envelope.candidate.unsupportedFeatures.join('; ')}`);
  if (envelope.projectBinding.status !== 'bound') blockers.push(`project binding is ${envelope.projectBinding.status}`);
  if (envelope.evidenceBinding.status !== 'bound') blockers.push('fixture evidence is not bound');
  if (!report) blockers.push('compilation report is required');
  if (report) {
    try { validateContract('ChangeSpecCompilationReport', report); } catch (error) { blockers.push(error instanceof Error ? error.message : String(error)); }
    if (report.status !== 'ready_for_approval') blockers.push(`compilation report status is ${report.status}`);
    if (report.inputHash !== envelope.sourceProvenance.inputHash) blockers.push('compilation report input hash mismatch');
    if (report.candidateHash !== canonicalHash(envelope.candidate)) blockers.push('compilation report candidate hash mismatch');
    for (const [label, values] of [
      ['structural validation', report.structuralValidation], ['semantic validation', report.semanticValidation],
      ['resolver compatibility', report.resolverCompatibility], ['missing evidence', report.missingEvidence],
      ['unsupported capabilities', report.unsupportedCapabilities], ['injection warnings', report.injectionWarnings],
    ] as const) if (values.length) blockers.push(`${label}: ${values.join('; ')}`);
    const hash = canonicalHash(report);
    if (envelope.compilerProvenance.compilationReportHash !== hash) blockers.push('compilation report hash mismatch');
    if (envelope.approval && envelope.approval.compilationReportHash !== hash) blockers.push('approval compilation report hash mismatch');
  }
  return { ready: blockers.length === 0, blockers: [...new Set(blockers)], warnings };
}

export function refreshCompilationReport(envelope: ChangeSpecEnvelope, report: ChangeSpecCompilationReport): { envelope: ChangeSpecEnvelope; report: ChangeSpecCompilationReport } {
  const missingEvidence = envelope.evidenceBinding.status === 'bound' ? [] : ['Fixture pair is not bound'];
  const projectBinding = envelope.projectBinding.status === 'bound' ? [] : [`Project binding is ${envelope.projectBinding.status}`];
  const blockers = report.structuralValidation.length || report.semanticValidation.length || report.resolverCompatibility.length || missingEvidence.length || report.unsupportedCapabilities.length || report.injectionWarnings.length || projectBinding.length || envelope.candidate.abstain || envelope.candidate.suspectedInjection || envelope.candidate.unknowns.length || envelope.candidate.unsupportedFeatures.length;
  const updated = validateContract('ChangeSpecCompilationReport', { ...report, candidateHash: canonicalHash(envelope.candidate), projectBinding, missingEvidence, status: blockers ? (missingEvidence.length ? 'evidence_missing' : projectBinding.length ? 'binding_failed' : 'needs_review') : 'ready_for_approval' });
  const compilerProvenance = { ...envelope.compilerProvenance, compilationReportHash: canonicalHash(updated) };
  const base = { ...envelope, compilerProvenance, bundleHash: undefined };
  return { envelope: { ...envelope, compilerProvenance, bundleHash: canonicalHash(base) }, report: updated };
}
