import { validateContract } from './validation';
import type { VerdictInput } from './stages';
import type { VerdictResult } from './contracts';

/** Phase 2 mechanical subset of L6. Unsupported semantic questions stay explicit. */
export function resolveVerdict(input: VerdictInput): VerdictResult {
  const { diff, entryPoint, bdg } = input;
  validateContract('DiffReport', diff);
  let verdict: VerdictResult['verdict'];
  let reason: string;
  if (!diff.stable || diff.divergences.some(d => d.kind === 'unstable')) { verdict = 'INDETERMINATE'; reason = 'nondeterministic_handler'; }
  else if (!bdg.affectedSites.some(site => site.entryPointId === entryPoint.id && site.provenance.confidence !== 'low')) { verdict = 'INDETERMINATE'; reason = 'insufficient_provenance'; }
  else if (diff.divergences.some(d => d.tier === 'mechanical' && (d.severity === 'critical' || d.severity === 'high'))) { verdict = 'FAIL'; reason = 'mechanical_incompatibility'; }
  else if (diff.divergences.some(d => d.tier === 'semantic_question')) { verdict = 'INDETERMINATE'; reason = 'unsupported_semantic_difference_in_phase2'; }
  else { verdict = 'PASS'; reason = diff.divergences.length ? 'only_informational_divergences' : 'identical_behavior'; }
  return validateContract('VerdictResult', { entryPointId: entryPoint.id, verdict, provenance: 'mechanical', reason,
    divergenceIds: diff.divergences.map(d => d.id), reasoningRefs: [], evidenceRefs: diff.divergences.map(d => ({ kind: 'diff', pointer: d.pointer })), suspectedInjection: false });
}
