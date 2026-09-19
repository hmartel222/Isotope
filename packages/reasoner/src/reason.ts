import { relative } from 'node:path';
import {
  artifactPaths, deterministicJson, writeJsonArtifact,
  type BDG, type ChangeSpec, type DiffReport, type EntryPoint, type EvidencePacket, type IsotopeConfig,
  type ReasoningRun, type Signature,
} from '@isotope/core';
import { apiKeyFromEnv, createGeminiModel, credentialsAvailable, type SemanticModel } from './adapter';
import { cacheKey, readReasonerCache, writeReasonerCache } from './cache';
import { resolveReasonerConsensus, type VoteOutcome } from './consensus';
import { evaluateReasoningEligibility } from './eligibility';
import { buildEvidencePacket } from './packet';
import { DEFAULT_REASONER_MODEL, REASONER_PROMPT_VERSION, REASONER_SYSTEM_PROMPT, schemaRetryMessage, userEvidenceMessage } from './prompt';
import { extractJson, validateReasoningResult } from './validate';

export const REQUEST_TIMEOUT_MS = 30_000;

export interface ReasonEntryInput {
  repoRoot: string; artifactRoot: string; spec: ChangeSpec; bdg: BDG; entryPoint: EntryPoint; diff: DiffReport;
  old: Signature; new: Signature; oldPayload: unknown; newPayload: unknown; config: IsotopeConfig;
  remainingInvocations: number; model?: SemanticModel; credentials?: boolean;
}

async function oneVote(model: SemanticModel, packet: EvidencePacket, user: string): Promise<VoteOutcome> {
  try {
    const raw = await Promise.race([
      model.classify({ system: REASONER_SYSTEM_PROMPT, user, timeoutMs: REQUEST_TIMEOUT_MS }),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timeout')), REQUEST_TIMEOUT_MS)),
    ]);
    let parsed: unknown;
    try { parsed = extractJson(raw); }
    catch { return { status: 'invalid', error: 'malformed_json' }; }
    const valid = validateReasoningResult(packet, parsed);
    if (!valid.ok) return { status: 'invalid', error: valid.reason };
    return { status: 'ok', result: valid.result };
  } catch (error) {
    const message = String(error);
    if (/timeout/i.test(message)) return { status: 'timeout', error: 'reasoner_timeout' };
    return { status: 'unavailable', error: message.slice(0, 500) };
  }
}

function extraId(id: string | null | undefined): Pick<ReasoningRun, 'primaryDivergenceId'> | Record<string, never> {
  return id ? { primaryDivergenceId: id } : {};
}

function unavailable(reason: string, extra: Partial<ReasoningRun> = {}): ReasoningRun {
  return { status: 'unavailable', results: [], packetRef: '', responseRefs: [], error: reason, promptVersion: REASONER_PROMPT_VERSION, ...extra };
}

/** Two independent votes over one entry-point packet. One mechanical schema retry total (apiAttempts <= 3). */
export async function reasonAboutEntryPoint(input: ReasonEntryInput): Promise<{ run: ReasoningRun; packet: EvidencePacket | null; invocationsUsed: number }> {
  const creds = input.credentials ?? credentialsAvailable();
  const eligibility = evaluateReasoningEligibility({
    diff: input.diff, bdg: input.bdg, entryPoint: input.entryPoint, config: input.config,
    credentialsAvailable: creds || Boolean(input.model), remainingInvocations: input.remainingInvocations,
  });
  if (!eligibility.eligible) return { run: unavailable(eligibility.reason, extraId(eligibility.primaryDivergenceId)), packet: null, invocationsUsed: 0 };
  const built = await buildEvidencePacket({
    repoRoot: input.repoRoot, spec: input.spec, bdg: input.bdg, entryPoint: input.entryPoint, diff: input.diff,
    old: input.old, new: input.new, oldPayload: input.oldPayload, newPayload: input.newPayload, redact: input.config.reasoner.redact,
  });
  if (!built.ok) return { run: unavailable(built.reason, extraId(eligibility.primaryDivergenceId)), packet: null, invocationsUsed: 0 };
  const paths = artifactPaths(input.artifactRoot);
  const packetPath = paths.evidencePacket(input.entryPoint.id, built.primaryDivergenceId);
  await writeJsonArtifact(paths.root, packetPath, 'EvidencePacket', built.packet);
  const packetRef = relative(paths.root, packetPath).split('\\').join('/');
  const model = input.model ?? (() => {
    const key = apiKeyFromEnv(); if (!key) return null;
    return createGeminiModel(key, DEFAULT_REASONER_MODEL);
  })();
  if (!model) return { run: unavailable('credentials_unavailable', { packetHash: built.hash, primaryDivergenceId: built.primaryDivergenceId, packetRef }), packet: built.packet, invocationsUsed: 0 };
  const key = cacheKey(built.hash, model.modelId);
  const cached = await readReasonerCache(input.artifactRoot, key);
  const writeVotes = async (voteA: import('@isotope/core').ReasoningResult, voteB: import('@isotope/core').ReasoningResult, cacheHit: boolean, attempts: number): Promise<ReasoningRun> => {
    const aPath = paths.reasoning(input.entryPoint.id, built.primaryDivergenceId, 0);
    const bPath = paths.reasoning(input.entryPoint.id, built.primaryDivergenceId, 1);
    await writeJsonArtifact(paths.root, aPath, 'ReasoningResult', voteA);
    await writeJsonArtifact(paths.root, bPath, 'ReasoningResult', voteB);
    const refs = [relative(paths.root, aPath).split('\\').join('/'), relative(paths.root, bPath).split('\\').join('/')];
    const consensus = resolveReasonerConsensus({ status: 'ok', result: voteA }, { status: 'ok', result: voteB });
    return {
      status: consensus.status, results: consensus.results, packetRef, responseRefs: refs,
      ...(consensus.status === 'completed' ? {} : { error: consensus.reason }),
      packetHash: built.hash, promptVersion: REASONER_PROMPT_VERSION, model: model.modelId, cacheHit, apiAttempts: attempts, primaryDivergenceId: built.primaryDivergenceId,
    };
  };
  if (cached) return { run: await writeVotes(cached.voteA, cached.voteB, true, 0), packet: built.packet, invocationsUsed: 0 };
  const serialized = deterministicJson(built.packet);
  const voteA = await oneVote(model, built.packet, userEvidenceMessage(serialized));
  const voteB = await oneVote(model, built.packet, userEvidenceMessage(serialized));
  let attempts = 2;
  let a = voteA; let b = voteB;
  if (a.status === 'invalid' && attempts < 3) { a = await oneVote(model, built.packet, schemaRetryMessage(serialized)); attempts += 1; }
  else if (b.status === 'invalid' && attempts < 3) { b = await oneVote(model, built.packet, schemaRetryMessage(serialized)); attempts += 1; }
  const consensus = resolveReasonerConsensus(a, b);
  if (a.status === 'ok' && b.status === 'ok') await writeReasonerCache(input.artifactRoot, key, { voteA: a.result, voteB: b.result });
  if (a.status !== 'ok' || b.status !== 'ok') {
    return {
      run: {
        status: consensus.status, results: consensus.results, packetRef, responseRefs: [], error: consensus.reason,
        packetHash: built.hash, promptVersion: REASONER_PROMPT_VERSION, model: model.modelId, cacheHit: false, apiAttempts: attempts, primaryDivergenceId: built.primaryDivergenceId,
      }, packet: built.packet, invocationsUsed: attempts,
    };
  }
  return { run: await writeVotes(a.result, b.result, false, attempts), packet: built.packet, invocationsUsed: attempts };
}
