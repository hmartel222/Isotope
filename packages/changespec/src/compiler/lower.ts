import { canonicalHash, validateContract, type ChangeSpec, type ChangeSpecCandidate, type ChangeSpecEnvelope, type DependencyBinding, type TypedPath, type TypedTaintRoot } from '@isotope/core';

export function lowerTypedPath(path: TypedPath): string {
  let out = '';
  for (const segment of path.segments) out += segment.kind === 'wildcard' ? '[*]' : `${out ? '.' : ''}${segment.name}`;
  return out;
}
export function lowerTypedRoot(root: TypedTaintRoot): string {
  if (root.kind === 'type') return root.qualifiedName.join('.');
  const target = [`$${root.receiver.toUpperCase()}`, ...root.members].join('.');
  return `${target}(${root.argumentMode === 'wildcard' ? '$$$' : ''})`;
}
function predicate(value: NonNullable<ChangeSpecEnvelope['candidate']['changes'][number]['ambiguity']>['predicate']): string {
  const path = lowerTypedPath(value.path);
  if (value.kind === 'field_present') return `${path} is present`;
  if (value.kind === 'field_absent') return `${path} is absent`;
  if (value.kind === 'array_length_equals') return `${path}.length == ${value.value}`;
  if (value.kind === 'array_length_greater_than') return `${path}.length > ${value.value}`;
  if (value.kind === 'values_all_equal') return `${path} values all equal`;
  return `${path} values differ`;
}

export function lowerCandidateForCompatibility(candidate: ChangeSpecCandidate, dependencyBinding: DependencyBinding, projectContext: { source?: string } = {}): ChangeSpec {
  return validateContract('ChangeSpec', {
    id: `compiled.draft.${canonicalHash(candidate).slice(0, 12)}`, provider: candidate.provider, title: candidate.title,
    source: projectContext.source ?? 'bounded compiler evidence', verified_by: 'draft',
    versions: { from: dependencyBinding.fromVersion, to: dependencyBinding.toVersion }, semantics: candidate.semantics,
    detection: { ecosystems: { [dependencyBinding.ecosystem]: { packages: [dependencyBinding.package], breaking_from: candidate.dependencyProposal.breakingFrom } }, taint_roots: candidate.taintRoots.map(root => ({ kind: root.kind, language: root.language, pattern: lowerTypedRoot(root) })) },
    changes: candidate.changes.map(change => ({
      object: change.object, ...(change.appliesToEvents ? { applies_to_events: change.appliesToEvents } : {}),
      ...(change.removedPath ? { removed_path: lowerTypedPath(change.removedPath) } : {}), ...(change.removedSymbol ? { removed_symbol: change.removedSymbol } : {}),
      replacement: { path: lowerTypedPath(change.replacement.path), cardinality: change.replacement.cardinality, ...(change.replacement.semantics ? { semantics: change.replacement.semantics } : {}) },
      ...(change.ambiguity ? { ambiguity: { when: predicate(change.ambiguity.predicate), question: change.ambiguity.question, options: change.ambiguity.options } } : {}),
      ...(change.repairPolicy ? { repair_policy: { business_policy_required_when: change.repairPolicy.businessPolicyRequiredWhen } } : {}),
      ...(change.codemod?.kind === 'path_rename' ? { codemod: { kind: 'path_rename' as const, safe_when: change.codemod.safeWhen, from: `$OBJ.${lowerTypedPath(change.codemod.from)}`, to: `$OBJ.${lowerTypedPath(change.codemod.to)}` } } : { codemod: { kind: 'unsupported' as const } }),
    })), fixtures: { pair: 'compatibility-only' },
  });
}

export function lowerEnvelope(envelope: ChangeSpecEnvelope): ChangeSpec {
  if (!envelope.approval || envelope.evidenceBinding.status !== 'bound' || envelope.projectBinding.status !== 'bound') throw new Error('Only an approved, project-bound, evidence-bound envelope can be lowered');
  const candidate = envelope.candidate;
  const pair = envelope.evidenceBinding.pair;
  if (!pair) throw new Error('Approved envelope is missing its fixture pair');
  const provisional = lowerCandidateForCompatibility(candidate, envelope.dependencyBinding, { source: envelope.sourceProvenance.sources.map(source => source.declaredUri ?? source.id).join(', ') });
  return validateContract('ChangeSpec', {
    ...provisional,
    id: `compiled.${candidate.provider}.${envelope.approval.candidateHash.slice(0, 12)}`,
    verified_by: 'human', verified_at: envelope.approval.approvedAt.slice(0, 10),
    versions: {
      from: envelope.evidenceBinding.oldVersion ?? envelope.dependencyBinding.fromVersion,
      to: envelope.evidenceBinding.newVersion ?? envelope.dependencyBinding.toVersion,
    },
    fixtures: { pair, ...(envelope.evidenceBinding.heldoutPair ? { heldout_pair: envelope.evidenceBinding.heldoutPair } : {}) },
  });
}

export function lowerApprovedEnvelope(envelope: ChangeSpecEnvelope): ChangeSpec {
  validateContract('ChangeSpecEnvelope', envelope);
  if (envelope.status !== 'approved' || !envelope.runtimeSpec) throw new Error('Only an approved envelope can be lowered');
  const lowered = lowerEnvelope(envelope);
  if (JSON.stringify(lowered) !== JSON.stringify(envelope.runtimeSpec)) throw new Error('Stored runtime spec does not match deterministic lowering');
  return lowered;
}
