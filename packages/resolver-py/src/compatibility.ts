import type { ChangeSpec, ResolverCompatibilityInput, ResolverCompatibilityResult } from '@isotope/core';
import { resolveBehavioralDependencyGraph } from './index';

function executableDraft(spec: ChangeSpec): ChangeSpec { return { ...spec, verified_by: 'human', verified_at: '1970-01-01' }; }
export async function checkResolverCompatibility(input: ResolverCompatibilityInput): Promise<ResolverCompatibilityResult> {
  const modules = input.config.mocks.filter(mock => 'strategy' in mock && mock.strategy === 'provider').map(mock => mock.module);
  const packages = input.candidateSpec.detection.ecosystems.pypi?.packages ?? [];
  const normalized = (value: string) => value.toLowerCase().replace(/[-_.]+/g, '-');
  const matching = modules.filter(module => packages.some(pkg => normalized(module.split('.')[0]!) === normalized(pkg)));
  if (new Set(matching).size > 1) return { status: 'ambiguous', language: 'py', module: matching.sort().join(','), matchedRoots: [], diagnostics: [`Multiple configured provider modules match: ${matching.join(', ')}`] };
  try {
    const bdg = await resolveBehavioralDependencyGraph({ repositoryRoot: input.repositoryRoot, config: input.config, changeSpec: executableDraft(input.candidateSpec) });
    const roots = bdg.nodes.filter(node => node.kind === 'taint_root' && node.provenance.confidence !== 'low');
    const diagnostics = bdg.skipped.map(item => `${item.file}:${item.reason}`);
    const matchedRoots = roots.map(root => ({ pattern: root.label, file: root.location.file, line: root.location.line, provenance: root.provenance.basis }));
    return { status: roots.length ? 'compatible' : 'unbound', language: 'py', module: matching[0] ?? packages[0] ?? 'unknown', matchedRoots, diagnostics: roots.length ? diagnostics : [...diagnostics, 'No production-resolver taint root matched'] };
  } catch (error) {
    return { status: /unsupported|pattern|path/i.test((error as Error).message) ? 'unsupported' : 'unbound', language: 'py', module: matching[0] ?? packages[0] ?? 'unknown', matchedRoots: [], diagnostics: [(error as Error).message] };
  }
}
