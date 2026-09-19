import { validateContract, type CandidatePatch, type EvidenceRef, type RepairPacket } from '@isotope/core';

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  return JSON.parse((fence ? fence[1]! : trimmed).trim()) as unknown;
}

export function validatePlannerEvidenceRefs(packet: RepairPacket, refs: EvidenceRef[]): string | null {
  for (const ref of refs) {
    if (ref.kind === 'code') {
      const inDownstream = packet.code.downstreamFunctions.some(fn => fn.path === ref.file);
      const inAllow = packet.constraints.allowedPaths.includes(ref.file);
      if (!inAllow && !inDownstream) return `evidenceRefs cite missing code ${ref.file}:${ref.line}`;
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

export function validatePlannerProposal(packet: RepairPacket, value: unknown, repairId: string): { ok: true; result: CandidatePatch } | { ok: false; reason: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'schema: not an object' };
  const raw = value as Record<string, unknown>;
  const merged = { ...raw, repairId, origin: 'model', patch: raw.patch === undefined ? null : raw.patch };
  let result: CandidatePatch;
  try { result = validateContract('CandidatePatch', merged); }
  catch (error) { return { ok: false, reason: `schema: ${String(error)}` }; }
  const classification = result.classification;
  if (classification === 'repair_candidate') {
    if (!result.patch?.files.length) return { ok: false, reason: 'repair_candidate requires a patch' };
    if (result.humanQuestion !== null) return { ok: false, reason: 'repair_candidate requires humanQuestion null' };
    if (!result.evidenceRefs.length) return { ok: false, reason: 'repair_candidate requires evidenceRefs' };
  } else {
    if (result.patch !== null) return { ok: false, reason: `${classification} must not include a patch` };
    if (classification === 'human_decision_required' && !result.humanQuestion) return { ok: false, reason: 'human_decision_required requires humanQuestion' };
  }
  const refs = validatePlannerEvidenceRefs(packet, result.evidenceRefs);
  if (refs) return { ok: false, reason: refs };
  return { ok: true, result };
}

export function normalizePatch(candidate: CandidatePatch): unknown {
  if (candidate.classification !== 'repair_candidate' || !candidate.patch) return null;
  return candidate.patch.files.map(file => ({
    path: file.path.replace(/\\/g, '/'),
    edits: [...file.edits].map(edit => ({ anchor: edit.anchor, replacement: edit.replacement })).sort((a, b) => a.anchor.localeCompare(b.anchor) || a.replacement.localeCompare(b.replacement)),
  })).sort((a, b) => a.path.localeCompare(b.path));
}

export function patchesEquivalent(a: CandidatePatch, b: CandidatePatch): boolean {
  return JSON.stringify(normalizePatch(a)) === JSON.stringify(normalizePatch(b));
}
