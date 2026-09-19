import type { ReasoningResult } from '@isotope/core';

export type VoteOutcome =
  | { status: 'ok'; result: ReasoningResult }
  | { status: 'invalid' | 'unavailable' | 'timeout' | 'error'; error: string };

export interface ReasonerConsensus {
  status: 'completed' | 'unavailable' | 'errored' | 'disagreed' | 'abstained';
  classification: ReasoningResult['classification'] | null;
  reason: string;
  results: ReasoningResult[];
}

/** Pure consensus. Classifications are never averaged. */
export function resolveReasonerConsensus(voteA: VoteOutcome, voteB: VoteOutcome): ReasonerConsensus {
  const failed = (status: ReasonerConsensus['status'], reason: string, results: ReasoningResult[] = []): ReasonerConsensus =>
    ({ status, classification: null, reason, results });
  if (voteA.status !== 'ok' || voteB.status !== 'ok') {
    const error = [voteA, voteB].filter(vote => vote.status !== 'ok').map(vote => vote.error).join('; ');
    const kind = [voteA, voteB].some(vote => vote.status === 'timeout' || vote.status === 'unavailable') ? 'unavailable' : 'errored';
    return failed(kind, error || 'reasoner_unavailable');
  }
  const votes = [voteA.result, voteB.result];
  if (votes.some(vote => vote.suspectedInjection)) return failed('errored', 'suspected_prompt_injection', votes);
  if (votes.some(vote => vote.abstain)) return failed('abstained', 'reasoner_abstained', votes);
  if (votes.some(vote => vote.confidence === 'low')) return failed('abstained', 'reasoner_low_confidence', votes);
  if (votes[0]!.classification !== votes[1]!.classification) return failed('disagreed', 'reasoner_disagreement', votes);
  return { status: 'completed', classification: votes[0]!.classification, reason: votes[0]!.classification, results: votes };
}
