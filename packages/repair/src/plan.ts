import { deterministicJson, type CandidatePatch, type RepairPlanInput } from '@isotope/core';
import { apiKeyFromEnv, createGeminiModel, credentialsAvailable, type SemanticModel } from '@isotope/reasoner';
import { DEFAULT_PLANNER_MODEL, PLANNER_PROMPT_VERSION, PLANNER_SYSTEM_PROMPT, plannerSchemaRetryMessage, plannerUserMessage } from './prompt';
import { extractJson, patchesEquivalent, validatePlannerProposal } from './validate';
import { assertNoHeldOutLeakage } from './packet';

export { PLANNER_PROMPT_VERSION, DEFAULT_PLANNER_MODEL };
export const REQUEST_TIMEOUT_MS = 30_000;

export interface PlanRepairResult {
  candidate: CandidatePatch;
  packetHash: string;
  model: string;
  promptVersion: number;
  invocationsUsed: number;
  error?: string;
}

type Attempt =
  | { status: 'ok'; result: CandidatePatch }
  | { status: 'invalid' | 'timeout' | 'unavailable'; error: string };

async function rawCall(model: SemanticModel, user: string): Promise<{ status: 'ok'; value: unknown } | { status: 'invalid' | 'timeout' | 'unavailable'; error: string }> {
  try {
    const raw = await Promise.race([
      model.classify({ system: PLANNER_SYSTEM_PROMPT, user, timeoutMs: REQUEST_TIMEOUT_MS }),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timeout')), REQUEST_TIMEOUT_MS)),
    ]);
    try { return { status: 'ok', value: extractJson(raw) }; }
    catch { return { status: 'invalid', error: 'malformed_json' }; }
  } catch (error) {
    const message = String(error);
    if (/timeout/i.test(message)) return { status: 'timeout', error: 'planner_timeout' };
    return { status: 'unavailable', error: message.slice(0, 500) };
  }
}

function declined(repairId: string, classification: 'human_decision_required' | 'no_safe_repair', reason: string, extra: Partial<CandidatePatch> = {}): CandidatePatch {
  return {
    repairId, classification, confidence: extra.confidence ?? 'medium', origin: 'model',
    summary: extra.summary ?? reason, causalChain: extra.causalChain ?? 'planner declined without an applicable patch',
    assumptions: extra.assumptions ?? [], evidenceRefs: extra.evidenceRefs ?? [],
    humanQuestion: classification === 'human_decision_required' ? (extra.humanQuestion ?? reason) : null,
    suspectedInjection: extra.suspectedInjection ?? false, abstain: extra.abstain ?? false, patch: null,
  };
}

/** Bounded L8 planner. Candidates have no authority. */
export async function planRepair(input: RepairPlanInput): Promise<CandidatePatch> {
  const packetJson = deterministicJson(input.packet);
  assertNoHeldOutLeakage(packetJson, ['held_out', 'sub_HELDOUT_UNIQUE']);
  const creds = input.credentials ?? credentialsAvailable();
  const model = input.model ?? (() => {
    const key = apiKeyFromEnv(); if (!key || !creds) return null;
    return createGeminiModel(key, DEFAULT_PLANNER_MODEL);
  })();
  if (!model) throw new Error('credentials_unavailable');
  const repairId = input.repairId;
  const attempt = async (user: string): Promise<Attempt> => {
    const first = await rawCall(model, user);
    if (first.status !== 'ok') return first;
    const valid = validatePlannerProposal(input.packet, first.value, repairId);
    if (!valid.ok) return { status: 'invalid', error: valid.reason };
    return { status: 'ok', result: valid.result };
  };
  const primaryUser = input.mechanicalRetryHint
    ? plannerSchemaRetryMessage(packetJson, input.mechanicalRetryHint)
    : plannerUserMessage(packetJson);
  let first = await attempt(primaryUser);
  if (first.status === 'invalid') first = await attempt(plannerSchemaRetryMessage(packetJson, first.error));
  if (first.status !== 'ok') {
    return declined(repairId, 'no_safe_repair', first.error, { abstain: first.status !== 'invalid', confidence: 'low' });
  }
  let chosen = first.result;
  if (input.config.selfConsistency) {
    let second = await attempt(plannerUserMessage(packetJson));
    if (second.status === 'invalid') second = await attempt(plannerSchemaRetryMessage(packetJson, second.error));
    if (second.status !== 'ok') return declined(repairId, 'no_safe_repair', second.error, { abstain: true, confidence: 'low' });
    if (chosen.suspectedInjection || second.result.suspectedInjection) {
      return declined(repairId, 'human_decision_required', 'Planner flagged suspected prompt injection', { suspectedInjection: true, humanQuestion: 'The repair packet contained instruction-like text.' });
    }
    if (chosen.classification === 'repair_candidate' && second.result.classification === 'repair_candidate' && !patchesEquivalent(chosen, second.result)) {
      return declined(repairId, 'human_decision_required', 'Independent planner proposals disagreed', { humanQuestion: 'Independent planner proposals produced different anchored edits.' });
    }
    if (chosen.classification !== second.result.classification) {
      return declined(repairId, 'human_decision_required', 'Independent planner classifications disagreed', { humanQuestion: 'Independent planner calls did not agree on a repair classification.' });
    }
  }
  if (chosen.suspectedInjection) {
    return declined(repairId, 'human_decision_required', 'Planner flagged suspected prompt injection', { suspectedInjection: true, humanQuestion: chosen.humanQuestion ?? 'The repair packet contained instruction-like text.' });
  }
  if (chosen.abstain || chosen.confidence === 'low') {
    const classification = chosen.classification === 'human_decision_required' ? 'human_decision_required' : 'no_safe_repair';
    return declined(repairId, classification, chosen.abstain ? 'Planner abstained' : 'Planner confidence was low', {
      humanQuestion: chosen.humanQuestion, abstain: chosen.abstain, confidence: chosen.confidence, summary: chosen.summary, causalChain: chosen.causalChain, evidenceRefs: chosen.evidenceRefs, assumptions: chosen.assumptions,
    });
  }
  return chosen;
}
