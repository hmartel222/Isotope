import { createHash } from 'node:crypto';
import {
  deterministicJson, validateContract,
  type BDG, type ChangeSpec, type DiffReport, type EntryPoint, type ReasoningResult,
  type RepairPacket, type Signature, type VerdictResult,
} from '@isotope/core';
import { buildEvidencePacket, estimateTokens, HARD_CAP_TOKENS } from '@isotope/reasoner';

export interface RepairPacketBuildInput {
  repoRoot: string; spec: ChangeSpec; bdg: BDG; entryPoint: EntryPoint; diff: DiffReport;
  verdict: VerdictResult; old: Signature; new: Signature; oldPayload: unknown; newPayload: unknown;
  redact: boolean; maxFiles: number; maxChangedLines: number; reasoning?: ReasoningResult[];
  heldOutForbidden?: string[];
}
export type RepairPacketBuildResult =
  | { ok: true; packet: RepairPacket; hash: string; estimatedTokens: number }
  | { ok: false; reason: string };

export function assertNoHeldOutLeakage(serialized: string, markers: string[]): void {
  for (const marker of markers) {
    if (marker && serialized.includes(marker)) throw new Error(`held_out_leakage: ${marker}`);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function explanation(verdict: VerdictResult, reasoning: ReasoningResult[] | undefined): { causalExplanation: string; affectedBehavior: string } {
  const reasoned = reasoning?.find(result => result.classification === 'incompatibility') ?? reasoning?.[0];
  if (reasoned) return { causalExplanation: reasoned.causalExplanation, affectedBehavior: reasoned.affectedBehavior };
  return {
    causalExplanation: 'Observed behavior diverged from the original application under the old provider contract.',
    affectedBehavior: verdict.reason,
  };
}

/** Reconstruct a RepairPacket from existing L1–L6 artifacts. Held-out evidence is never an input. */
export async function buildRepairPacket(input: RepairPacketBuildInput): Promise<RepairPacketBuildResult> {
  const divergences = input.diff.divergences.filter(item => item.kind !== 'identical');
  const evidence = await buildEvidencePacket({
    repoRoot: input.repoRoot, spec: input.spec, bdg: input.bdg, entryPoint: input.entryPoint, diff: input.diff,
    old: input.old, new: input.new, oldPayload: input.oldPayload, newPayload: input.newPayload, redact: input.redact,
    divergences: divergences.length ? divergences : input.diff.divergences,
  });
  if (!evidence.ok) return { ok: false, reason: evidence.reason };
  const allowed = [...new Set(input.bdg.affectedSites
    .filter(site => site.entryPointId === input.entryPoint.id && site.provenance.confidence !== 'low')
    .map(site => site.location.file.split('\\').join('/')))].sort().slice(0, 3);
  if (!allowed.length) return { ok: false, reason: 'allow_list_empty' };
  const site = input.bdg.affectedSites.find(item => item.entryPointId === input.entryPoint.id);
  const change = input.spec.changes[site?.changeIndex ?? 0] ?? input.spec.changes[0]!;
  const knownSafeCodemod = change.codemod ?? null;
  const text = explanation(input.verdict, input.reasoning);
  const packet = validateContract('RepairPacket', {
    repairPacketVersion: 1,
    change: {
      specId: input.spec.id, provider: input.spec.provider, semantics: input.spec.semantics,
      removedPath: change.removed_path, replacement: change.replacement, knownSafeCodemod,
    },
    verdict: { type: input.verdict.verdict === 'FAIL_REASONED' ? 'FAIL_REASONED' : 'FAIL', ...text },
    code: {
      primarySlice: evidence.packet.code.slice,
      downstreamFunctions: evidence.packet.code.downstreamFunctions.map(fn => ({ path: fn.file, name: fn.name, slice: fn.slice })),
    },
    dataflow: evidence.packet.dataflow,
    execution: {
      baselineSignature: { ...evidence.packet.execution.old, codeVersion: 'original' as const, durationMs: 0 },
      newSignature: { ...evidence.packet.execution.new, codeVersion: 'original' as const, durationMs: 0 },
    },
    diff: evidence.packet.diff,
    providerPayloadFragments: evidence.packet.payloadFragments,
    constraints: {
      allowedPaths: allowed,
      maxFiles: clamp(input.maxFiles, 1, 3),
      maxChangedLines: clamp(input.maxChangedLines, 1, 80),
    },
  });
  const serialized = deterministicJson(packet);
  const tokens = estimateTokens(serialized);
  if (tokens > HARD_CAP_TOKENS) return { ok: false, reason: 'packet_budget_exceeded' };
  const markers = [
    ...(input.heldOutForbidden ?? []),
    input.spec.fixtures.heldout_pair ?? '',
    'held_out',
    'sub_HELDOUT_UNIQUE',
  ];
  assertNoHeldOutLeakage(serialized, markers);
  return { ok: true, packet, hash: createHash('sha256').update(serialized).digest('hex'), estimatedTokens: tokens };
}
