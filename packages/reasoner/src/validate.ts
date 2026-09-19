import type { EvidencePacket, EvidenceRef, ReasoningResult } from '@isotope/core';
import { validateContract } from '@isotope/core';

const WEAK = /^(looks fine|seems fine|ok|fine|lgtm|no issue)\.?$/i;

export function sentenceCount(text: string): number {
  return text.trim().split(/(?<=[.!?])\s+/).filter(part => part.trim()).length;
}

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  return JSON.parse((fence ? fence[1]! : trimmed).trim()) as unknown;
}

export function validateEvidenceRefs(packet: EvidencePacket, refs: EvidenceRef[]): string | null {
  for (const ref of refs) {
    if (ref.kind === 'code') {
      const lines = packet.code.entryPoint.lines;
      const inPrimary = ref.file === packet.code.entryPoint.file && ref.line >= lines[0] && ref.line <= lines[1];
      const inDownstream = packet.code.downstreamFunctions.some(fn => fn.file === ref.file);
      if (!inPrimary && !inDownstream) return `evidenceRefs cite missing code ${ref.file}:${ref.line}`;
    } else if (ref.kind === 'dataflow') {
      if (!packet.dataflow.nodes.some(node => node.id === ref.nodeId)) return `evidenceRefs cite missing BDG node ${ref.nodeId}`;
    } else if (ref.kind === 'diff') {
      if (!packet.diff.some(divergence => divergence.pointer === ref.pointer)) return `evidenceRefs cite missing diff pointer ${ref.pointer}`;
    } else {
      return `evidenceRefs cite unsupported kind ${(ref as { kind: string }).kind}`;
    }
  }
  return null;
}

/** Local schema + packet-relative validation. API structured-output guarantees are not product authority. */
export function validateReasoningResult(packet: EvidencePacket, value: unknown): { ok: true; result: ReasoningResult } | { ok: false; reason: string } {
  let result: ReasoningResult;
  try { result = validateContract('ReasoningResult', value); }
  catch (error) { return { ok: false, reason: `schema: ${String(error)}` }; }
  const sentences = sentenceCount(result.causalExplanation);
  if (sentences < 1 || sentences > 3) return { ok: false, reason: 'causalExplanation must be 1-3 sentences' };
  if (result.classification === 'human_decision_required') {
    if (!result.humanQuestion) return { ok: false, reason: 'human_decision_required requires humanQuestion' };
    if (result.recommendedAction !== 'ask_human') return { ok: false, reason: 'human_decision_required requires recommendedAction=ask_human' };
  } else if (result.humanQuestion !== null) return { ok: false, reason: 'humanQuestion must be null unless human_decision_required' };
  if (result.classification === 'benign_adaptation') {
    if (WEAK.test(result.causalExplanation.trim()) || result.causalExplanation.trim().length < 24) return { ok: false, reason: 'benign_adaptation explanation is not tied to evidence' };
    if (!result.evidenceRefs.length) return { ok: false, reason: 'benign_adaptation requires evidenceRefs' };
  }
  if (result.classification === 'incompatibility' && !result.evidenceRefs.length) return { ok: false, reason: 'incompatibility requires evidenceRefs' };
  const refs = validateEvidenceRefs(packet, result.evidenceRefs);
  if (refs) return { ok: false, reason: refs };
  return { ok: true, result };
}
