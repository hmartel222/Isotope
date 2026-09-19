import { ArtifactValidationError, validateContract } from './validation';
import type { VerdictInput } from './stages';
import type { DiffReport, VerdictResult } from './contracts';

export function hasMechanicalFailure(diff: DiffReport): boolean {
  return diff.divergences.some(d => d.tier === 'mechanical' && (d.severity === 'critical' || d.severity === 'high'));
}
/** A structural routing seam only; future L5 still applies provenance/config/budget checks. */
export function needsSemanticReasoning(diff: DiffReport): boolean {
  return diff.stable && !diff.divergences.some(d => d.kind === 'unstable') && !hasMechanicalFailure(diff)
    && diff.divergences.some(d => d.tier === 'semantic_question');
}

/** Pure L6 structural boundary. Reasoned states require a future implemented L5. */
export function resolveVerdict(input: VerdictInput): VerdictResult {
  const { diff, entryPoint } = input;
  validateContract('DiffReport', diff);
  if (diff.entryPointId !== entryPoint.id) throw new ArtifactValidationError('VerdictInput', ['diff must identify the selected entry point']);
  let verdict: VerdictResult['verdict'];
  let provenance: VerdictResult['provenance'] = 'mechanical';
  let reason: string;
  if (!diff.stable || diff.divergences.some(d => d.kind === 'unstable')) { verdict = 'INDETERMINATE'; reason = 'nondeterministic_handler'; }
  else if (hasMechanicalFailure(diff)) { verdict = 'FAIL'; reason = 'mechanical_incompatibility'; }
  else if (diff.divergences.some(d => d.tier === 'semantic_question')) {
    verdict = 'ESCALATE'; provenance = 'unavailable'; reason = 'semantic_reasoner_unavailable';
  } else { verdict = 'PASS'; reason = diff.divergences.length ? 'only_informational_divergences' : 'identical_behavior'; }
  return validateContract('VerdictResult', { entryPointId: entryPoint.id, verdict, provenance, reason,
    divergenceIds: diff.divergences.map(d => d.id), reasoningRefs: [], evidenceRefs: diff.divergences.map(d => ({ kind: 'diff', pointer: d.pointer })), suspectedInjection: false });
}
