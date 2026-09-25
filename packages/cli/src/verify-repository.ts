import { realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { selectApprovedEnvelope, selectChangeSpecs, type SelectionResult } from '@isotope/changespec';
import { artifactPaths, validateContract, writeJsonArtifact, type IsotopeReport } from '@isotope/core';
import { verifyWalkingSkeleton, type WalkingSkeletonResult } from './walking-skeleton';

export interface VerifyRepositoryOptions {
  repositoryRoot: string;
  configPath: string;
  specsPath?: string;
  changeSpecBundlePath?: string;
  fixturesPath?: string;
  specId?: string;
  baseRef: string;
  headRef: string;
  reasoner: 'on' | 'off';
  repair: 'on' | 'off';
  /** Internal acceptance only; product Action runs never set this. */
  testFixtureDirectory?: string;
}
export interface VerifyRepositoryResult {
  exitCode: 0 | 1 | 3 | 4 | 5;
  output: string;
  report: IsotopeReport;
  selection: SelectionResult;
  artifactRoot: string;
  execution: WalkingSkeletonResult | null;
  bundleHash?: string;
}

function resolveOutsideOrInside(repositoryRoot: string, candidate: string, label: string): string {
  if (!candidate.trim()) throw new Error(`${label} is required`);
  return isAbsolute(candidate) ? candidate : resolve(repositoryRoot, candidate);
}

/** Shared Phase 6-8 orchestration used by both CLI and GitHub Action. */
export async function verifyRepository(options: VerifyRepositoryOptions): Promise<VerifyRepositoryResult> {
  const repositoryRoot = await realpath(resolve(options.repositoryRoot));
  const configPath = await realpath(resolve(repositoryRoot, options.configPath));
  if (Boolean(options.specsPath) === Boolean(options.changeSpecBundlePath)) throw new Error('Exactly one of specsPath or changeSpecBundlePath is required');
  const bundlePath = options.changeSpecBundlePath ? await realpath(resolveOutsideOrInside(repositoryRoot, options.changeSpecBundlePath, 'changeSpecBundlePath')) : undefined;
  const specsPath = options.specsPath ? await realpath(resolveOutsideOrInside(repositoryRoot, options.specsPath, 'specsPath')) : undefined;
  const envelopeSelection = bundlePath ? await selectApprovedEnvelope({ repositoryRoot, baseRef: options.baseRef, headRef: options.headRef, bundlePath }) : undefined;
  const selection = envelopeSelection ?? await selectChangeSpecs({ repositoryRoot, baseRef: options.baseRef, headRef: options.headRef, specsRoot: specsPath! });
  if (options.specId) {
    const specs = selection.selected.specs.filter(spec => spec.id === options.specId);
    if (!specs.length) throw new Error(`Selected dependency change does not match ChangeSpec ${options.specId}`);
    selection.selected = validateContract('SelectedSpecs', { ...selection.selected, specs });
  }
  const paths = artifactPaths(repositoryRoot);
  await writeJsonArtifact(paths.root, paths.selectedSpecs, 'SelectedSpecs', selection.selected);
  const selectionOutput = ['Dependency changes:', ...selection.dependencyChanges.map(c => `  ${c.package} ${c.fromVersion} → ${c.toVersion} (${c.ecosystem})`),
    'Selected ChangeSpecs:', ...(selection.selected.specs.length ? selection.selected.specs.map(s => `  ${s.id}`) : ['  none'])].join('\n');
  if (!selection.selected.specs.length) {
    const verdict = validateContract('VerdictReport', { schemaVersion: 1, verdict: 'SKIP', results: [] });
    const report = validateContract('IsotopeReport', { schemaVersion: 1, selectedSpecs: selection.selected, bdgRef: 'not-run', signatureRefs: [], diffReportRefs: [], evidencePacketRefs: [], reasoningRefs: [], verdict, repairPacketRefs: [], candidateRefs: [], repairVerifications: [], verifiedRepairs: [], audit: [] });
    await writeJsonArtifact(paths.root, paths.verdict, 'VerdictReport', verdict);
    await writeJsonArtifact(paths.root, paths.report, 'IsotopeReport', report);
    return { exitCode: 0, output: `${selectionOutput}\nVerdict: SKIP`, report, selection, artifactRoot: paths.root, execution: null, ...(envelopeSelection ? { bundleHash: envelopeSelection.bundleHash } : {}) };
  }
  const fixtureRoot = options.fixturesPath?.trim()
    ? resolveOutsideOrInside(repositoryRoot, options.fixturesPath, 'fixturesPath')
    : resolve(repositoryRoot, 'fixtures/normalized');
  const execution = await verifyWalkingSkeleton({ configPath, disableReasoner: options.reasoner === 'off', disableRepair: options.repair === 'off', selectedSpecs: selection.selected, fixtureRoot,
    ...(options.testFixtureDirectory ? { testFixtureDirectory: options.testFixtureDirectory } : {}) });
  return { exitCode: execution.exitCode, output: `${selectionOutput}${envelopeSelection ? `\nChangeSpec bundle: ${envelopeSelection.bundleHash}` : ''}\n${execution.output}`, report: execution.report, selection, artifactRoot: paths.root, execution, ...(envelopeSelection ? { bundleHash: envelopeSelection.bundleHash } : {}) };
}
