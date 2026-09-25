import { validateContract, type ChangeSpecCandidate, type ChangeSpecInputPacket } from '@isotope/core';

export interface CandidateDiagnostics { errors: string[]; warnings: string[] }

export function validateCandidate(candidateValue: unknown, packet: ChangeSpecInputPacket): { candidate?: ChangeSpecCandidate; diagnostics: CandidateDiagnostics } {
  const errors: string[] = [];
  const warnings: string[] = [];
  let candidate: ChangeSpecCandidate;
  try { candidate = validateContract('ChangeSpecCandidate', candidateValue); }
  catch (error) { return { diagnostics: { errors: [error instanceof Error ? error.message : String(error)], warnings } }; }
  const dependency = candidate.dependencyProposal;
  if (dependency.ecosystem !== packet.dependency.ecosystem || dependency.package !== packet.dependency.package) errors.push('Candidate changed the host-supplied dependency tuple');
  if (candidate.describedVersions.from !== packet.dependency.fromVersion || candidate.describedVersions.to !== packet.dependency.toVersion) errors.push('Candidate changed the host-supplied versions');
  const sources = new Map(packet.sources.map(source => [source.id, source.content]));
  const citations = [candidate.semanticsCitations, ...candidate.changes.flatMap(change => [change.citations.removed, change.citations.replacement, change.citations.events ?? []])].flat();
  for (const citation of citations) {
    const content = sources.get(citation.sourceId);
    if (!content) errors.push(`Citation references unknown source: ${citation.sourceId}`);
    else if (!content.includes(citation.excerpt)) errors.push(`Citation excerpt is absent from source ${citation.sourceId}`);
  }
  for (const root of candidate.taintRoots) if (!packet.supportedLanguages.includes(root.language)) errors.push(`Unsupported root language: ${root.language}`);
  if (candidate.suspectedInjection) warnings.push('Model marked source material as suspected prompt injection');
  if (candidate.abstain) warnings.push('Model abstained');
  return errors.length ? { diagnostics: { errors, warnings } } : { candidate, diagnostics: { errors, warnings } };
}
