import { ArtifactValidationError, validateContract } from './validation';
import type { ReasoningRun, VerdictInput } from './stages';
import type { DiffReport, Verdict, VerdictReport, VerdictResult } from './contracts';

/** PR-level precedence: earlier entries dominate later ones. */
export const VERDICT_PRECEDENCE: readonly Verdict[] = ['FAIL', 'FAIL_REASONED', 'ESCALATE', 'INDETERMINATE', 'PASS_REASONED', 'PASS', 'SKIP'];

export function hasMechanicalFailure(diff: DiffReport): boolean {
  return diff.divergences.some(d => d.tier === 'mechanical' && (d.severity === 'critical' || d.severity === 'high'));
}
/** A structural routing seam only; L5 still applies provenance/config/budget checks before invocation. */
export function needsSemanticReasoning(diff: DiffReport): boolean {
  return diff.stable && !diff.divergences.some(d => d.kind === 'unstable') && !hasMechanicalFailure(diff)
    && diff.divergences.some(d => d.tier === 'semantic_question');
}

function reasoned(run: ReasoningRun | null, configMode: 'on' | 'off' | undefined): { verdict: VerdictResult['verdict']; provenance: VerdictResult['provenance']; reason: string; refs: string[]; injection: boolean } {
  if (configMode !== 'on' || !run) return { verdict: 'ESCALATE', provenance: 'unavailable', reason: 'semantic_reasoner_unavailable', refs: [], injection: false };
  const injection = run.results.some(result => result.suspectedInjection) || /injection/i.test(run.error ?? '');
  const refs = run.responseRefs;
  if (injection) return { verdict: 'ESCALATE', provenance: 'reasoned', reason: 'suspected_prompt_injection', refs, injection: true };
  if (run.status === 'unavailable') return { verdict: 'ESCALATE', provenance: 'unavailable', reason: run.error ?? 'semantic_reasoner_unavailable', refs, injection: false };
  if (run.status === 'errored') return { verdict: 'ESCALATE', provenance: 'unavailable', reason: run.error ?? 'reasoner_error', refs, injection: false };
  if (run.status === 'disagreed') return { verdict: 'ESCALATE', provenance: 'reasoned', reason: 'reasoner_disagreement', refs, injection: false };
  if (run.status === 'abstained') return { verdict: 'ESCALATE', provenance: 'reasoned', reason: run.error ?? 'reasoner_abstained', refs, injection: false };
  const votes = run.results;
  if (votes.length !== 2) return { verdict: 'ESCALATE', provenance: 'unavailable', reason: 'reasoner_incomplete_votes', refs, injection: false };
  if (votes.some(vote => vote.abstain)) return { verdict: 'ESCALATE', provenance: 'reasoned', reason: 'reasoner_abstained', refs, injection: false };
  if (votes.some(vote => vote.confidence === 'low')) return { verdict: 'ESCALATE', provenance: 'reasoned', reason: 'reasoner_low_confidence', refs, injection: false };
  if (votes[0]!.classification !== votes[1]!.classification) return { verdict: 'ESCALATE', provenance: 'reasoned', reason: 'reasoner_disagreement', refs, injection: false };
  const classification = votes[0]!.classification;
  if (classification === 'human_decision_required') return { verdict: 'ESCALATE', provenance: 'reasoned', reason: 'human_decision_required', refs, injection: false };
  if (classification === 'incompatibility') return { verdict: 'FAIL_REASONED', provenance: 'reasoned', reason: 'reasoned_incompatibility', refs, injection: false };
  return { verdict: 'PASS_REASONED', provenance: 'reasoned', reason: 'reasoned_benign_adaptation', refs, injection: false };
}

/** Pure L6. Mechanical critical/high never reads reasoner output. */
export function resolveVerdict(input: VerdictInput): VerdictResult {
  const { diff, entryPoint } = input;
  validateContract('DiffReport', diff);
  if (diff.entryPointId !== entryPoint.id) throw new ArtifactValidationError('VerdictInput', ['diff must identify the selected entry point']);
  let verdict: VerdictResult['verdict'];
  let provenance: VerdictResult['provenance'] = 'mechanical';
  let reason: string;
  let reasoningRefs: string[] = [];
  let suspectedInjection = false;
  if (!diff.stable || diff.divergences.some(d => d.kind === 'unstable')) { verdict = 'INDETERMINATE'; reason = 'nondeterministic_handler'; }
  else if (hasMechanicalFailure(diff)) { verdict = 'FAIL'; reason = 'mechanical_incompatibility'; }
  else if (diff.divergences.some(d => d.tier === 'semantic_question')) {
    const resolved = reasoned(input.reasoning, input.config?.reasoner.mode);
    verdict = resolved.verdict; provenance = resolved.provenance; reason = resolved.reason;
    reasoningRefs = resolved.refs; suspectedInjection = resolved.injection;
  } else { verdict = 'PASS'; reason = diff.divergences.length ? 'only_informational_divergences' : 'identical_behavior'; }
  return validateContract('VerdictResult', { entryPointId: entryPoint.id, verdict, provenance, reason,
    divergenceIds: diff.divergences.map(d => d.id), reasoningRefs, evidenceRefs: diff.divergences.map(d => ({ kind: 'diff', pointer: d.pointer })), suspectedInjection });
}

export function resolveAggregateVerdict(results: VerdictResult[]): VerdictReport {
  if (!results.length) return validateContract('VerdictReport', { schemaVersion: 1, verdict: 'SKIP', results: [] });
  const verdict = [...results].sort((a, b) => VERDICT_PRECEDENCE.indexOf(a.verdict) - VERDICT_PRECEDENCE.indexOf(b.verdict))[0]!.verdict;
  return validateContract('VerdictReport', { schemaVersion: 1, verdict, results });
}
