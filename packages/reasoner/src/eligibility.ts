import { hasMechanicalFailure, type ReasoningEligibility, type ReasoningEligibilityInput } from '@isotope/core';

export function semanticDivergences(diff: ReasoningEligibilityInput['diff']) {
  return diff.divergences.filter(divergence => divergence.tier === 'semantic_question').sort((a, b) => a.id.localeCompare(b.id));
}

/** Pure L5 gate. Never performs I/O or constructs a packet. */
export function evaluateReasoningEligibility(input: ReasoningEligibilityInput): ReasoningEligibility {
  const none = (reason: string): ReasoningEligibility => ({ eligible: false, reason, primaryDivergenceId: null, divergenceIds: [] });
  if (!input.diff.stable || input.diff.divergences.some(divergence => divergence.kind === 'unstable')) return none('unstable');
  if (hasMechanicalFailure(input.diff)) return none('mechanical_failure');
  const semantic = semanticDivergences(input.diff);
  if (!semantic.length) return none(input.diff.divergences.length ? 'info_only' : 'no_divergence');
  if (semantic.every(divergence => divergence.sinkKind === 'log_only')) return none('log_only_only');
  const sites = input.bdg.affectedSites.filter(site => site.entryPointId === input.entryPoint.id);
  const authoritative = sites.filter(site => site.provenance.confidence === 'high' || site.provenance.confidence === 'medium');
  if (!authoritative.length) return none('low_confidence_site');
  if (input.config.reasoner.mode !== 'on') return none('reasoner_disabled');
  if (!input.credentialsAvailable) return none('credentials_unavailable');
  if (input.remainingInvocations < 2) return none('invocation_cap_exceeded');
  return { eligible: true, reason: 'semantic_residual', primaryDivergenceId: semantic[0]!.id, divergenceIds: semantic.map(divergence => divergence.id) };
}
