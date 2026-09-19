import type { ReasonAboutDivergence } from '@isotope/core';

export { evaluateReasoningEligibility, semanticDivergences } from './eligibility';
export { buildEvidencePacket, packetHash } from './packet';
export { estimateTokens, HARD_CAP_TOKENS, TARGET_TOKENS, TOKEN_BUDGET_MODE } from './tokens';
export { redactSource } from './redact';
export { REASONER_PROMPT_VERSION, REASONING_SCHEMA_VERSION, DEFAULT_REASONER_MODEL, REASONER_SYSTEM_PROMPT } from './prompt';
export { validateReasoningResult, extractJson } from './validate';
export { resolveReasonerConsensus } from './consensus';
export { createAnthropicModel, credentialsAvailable, apiKeyFromEnv, type SemanticModel, type ReasonerRequest } from './adapter';
export { cacheKey } from './cache';
export { reasonAboutEntryPoint, REQUEST_TIMEOUT_MS, type ReasonEntryInput } from './reason';

/** Packet-only stage input cannot reconstruct trusted L1–L4 evidence. Use reasonAboutEntryPoint. */
export const reasonAboutDivergence: ReasonAboutDivergence = async () => {
  throw new Error('reasonAboutDivergence requires reasonAboutEntryPoint with trusted L1-L4 artifacts');
};
