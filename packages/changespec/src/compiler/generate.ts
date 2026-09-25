import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ChangeSpecCandidateSchema, canonicalHash, validateContract, type ChangeSpecCandidate, type ChangeSpecCompilationReport, type ChangeSpecEnvelope, type ChangeSpecInputPacket } from '@isotope/core';
import type { StructuredModel } from '@isotope/model-gateway';
import { bindProject } from './bind-project';
import { rehashEnvelope } from './envelope';
import { COMPILER_PROMPT_VERSION, COMPILER_SYSTEM_PROMPT, COMPILER_VERSION, compilerInput } from './prompt';
import { validateCandidate } from './validate';

export interface CompileOptions { packet: ChangeSpecInputPacket; model: StructuredModel; repositoryRoot: string; cacheDirectory?: string }
export interface CompilationResult { envelope: ChangeSpecEnvelope; report: ChangeSpecCompilationReport; rawResponse: string }

function rawHash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function cacheKey(packet: ChangeSpecInputPacket, modelId: string): string { return canonicalHash({ inputHash: packet.inputHash, modelId, promptVersion: COMPILER_PROMPT_VERSION, schema: 1 }); }

async function readCache(directory: string | undefined, key: string): Promise<{ raw: string; candidate: unknown } | null> {
  if (!directory) return null;
  try { return JSON.parse(await readFile(join(directory, `${key}.json`), 'utf8')) as { raw: string; candidate: unknown }; } catch { return null; }
}
async function writeCache(directory: string | undefined, key: string, value: { raw: string; candidate: ChangeSpecCandidate }): Promise<void> {
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${key}.json`), JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export async function compileChangeSpec(options: CompileOptions): Promise<CompilationResult> {
  validateContract('ChangeSpecInputPacket', options.packet);
  const key = cacheKey(options.packet, options.model.modelId);
  const cached = await readCache(options.cacheDirectory, key);
  let raw = cached?.raw ?? '';
  let candidateValue = cached?.candidate;
  let invocationCount = 0;
  let modelFailure = '';
  if (!cached) {
    for (let attempt = 0; attempt < 2; attempt++) {
      invocationCount += 1;
      const result = await options.model.generate<unknown>({
        system: COMPILER_SYSTEM_PROMPT,
        input: compilerInput(options.packet, attempt ? 'The previous response failed local schema or citation validation. Return one corrected candidate JSON object and do not add fields.' : undefined),
        schema: ChangeSpecCandidateSchema as unknown as Record<string, unknown>, timeoutMs: 30_000, maxOutputTokens: 4_096,
      });
      raw = result.raw;
      if (result.status !== 'completed') { modelFailure = `${result.status}: ${result.error ?? 'no response'}`; continue; }
      const checked = validateCandidate(result.parsed, options.packet);
      if (checked.candidate) { candidateValue = checked.candidate; break; }
      modelFailure = checked.diagnostics.errors.join('; ');
    }
  }
  const checked = validateCandidate(candidateValue, options.packet);
  if (!checked.candidate) throw new Error(`MODEL_OUTPUT_INVALID: ${modelFailure || checked.diagnostics.errors.join('; ')}`);
  const candidate = checked.candidate;
  await writeCache(options.cacheDirectory, key, { raw, candidate });
  const projectBinding = await bindProject(candidate, options.packet.dependency, options.repositoryRoot);
  const sourceProvenance = { inputHash: options.packet.inputHash, sources: options.packet.sources.map(({ id, declaredUri, mediaType, sha256 }) => ({ id, ...(declaredUri ? { declaredUri } : {}), mediaType, sha256 })) };
  const status = projectBinding.status === 'bound' ? 'validated' as const : 'draft' as const;
  const report = validateContract('ChangeSpecCompilationReport', {
    schemaVersion: 1, inputHash: options.packet.inputHash, candidateHash: canonicalHash(candidate), compilerVersion: COMPILER_VERSION,
    promptVersion: COMPILER_PROMPT_VERSION, modelId: options.model.modelId, invocationCount, cacheStatus: cached ? 'hit' : options.cacheDirectory ? 'miss' : 'disabled',
    structuralValidation: [], semanticValidation: checked.diagnostics.errors, projectBinding: projectBinding.status === 'bound' ? [] : ['No unique repository import/root binding found'],
    resolverCompatibility: projectBinding.status === 'bound' ? [] : projectBinding.diagnostics ?? [`Resolver compatibility status: ${projectBinding.status}`], missingEvidence: ['Fixture pair is not bound'], unsupportedCapabilities: candidate.unsupportedFeatures,
    injectionWarnings: candidate.suspectedInjection ? ['Source or response was marked injection-suspected'] : [],
    status: candidate.abstain || candidate.suspectedInjection || candidate.unknowns.length || candidate.unsupportedFeatures.length ? 'needs_review' : projectBinding.status !== 'bound' ? 'binding_failed' : 'evidence_missing',
  });
  const envelope = validateContract('ChangeSpecEnvelope', rehashEnvelope({
    schemaVersion: 1, status, candidate, sourceProvenance,
    compilerProvenance: { compilerVersion: COMPILER_VERSION, promptVersion: COMPILER_PROMPT_VERSION, modelId: options.model.modelId, invocationCount, rawResponseHash: rawHash(raw), compilationReportHash: canonicalHash(report), cacheStatus: cached ? 'hit' : options.cacheDirectory ? 'miss' : 'disabled' },
    dependencyBinding: options.packet.dependency, projectBinding, evidenceBinding: { status: 'missing', fixtureHashes: {} },
  }));
  return { envelope, report, rawResponse: raw };
}
