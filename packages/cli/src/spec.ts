import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { approveEnvelope, bindEnvelopeEvidence, buildInputPacket, compileChangeSpec, createEvidenceBinding, draftSpec, evaluateApprovalReadiness, listSpecFiles, loadHumanSpecs, refreshCompilationReport, renderDraftYaml, normalizeFixtures, revokeEnvelope } from '@isotope/changespec';
import { deterministicJson, validateContract, type ChangeSpecCompilationReport, type ChangeSpecEnvelope } from '@isotope/core';
import { createGeminiStructuredModel, geminiApiKey } from '@isotope/model-gateway';
import { parse } from 'yaml';

function specsRoot(): string { return resolve(__dirname, '../../../specs'); }

export async function specList(): Promise<{ output: string; exitCode: number }> {
  const specs = await loadHumanSpecs(specsRoot());
  const drafts = (await listSpecFiles(specsRoot())).length - specs.length;
  const lines = ['Human-verified ChangeSpecs:', ...specs.map(s => `  ${s.id}  ${s.provider}  ${s.verified_at}`), drafts ? `Draft files present but excluded from L1: ${drafts}` : 'No draft specs in the registry.'];
  return { output: lines.join('\n'), exitCode: 0 };
}

export async function specValidate(path?: string): Promise<{ output: string; exitCode: number }> {
  const files = path ? [path] : (await listSpecFiles(specsRoot())).map(f => join(specsRoot(), f));
  const lines: string[] = [];
  let failed = false;
  for (const file of files) {
    try {
      const text = await readFile(resolve(file), 'utf8');
      const value = extname(file) === '.json' ? JSON.parse(text) : parse(text) as unknown;
      if (value && typeof value === 'object' && 'candidate' in value) {
        const envelope = validateContract('ChangeSpecEnvelope', value);
        lines.push(`${file}: OK (envelope status=${envelope.status}, bundle=${envelope.bundleHash})`);
      } else {
        const spec = validateContract('ChangeSpec', value);
        lines.push(`${file}: OK (${spec.id}, verified_by=${spec.verified_by})`);
        if (spec.verified_by === 'draft') lines.push('  note: draft specs never enter L1');
      }
    } catch (error) {
      failed = true;
      lines.push(`${file}: INVALID ${error instanceof Error ? error.message : error}`);
    }
  }
  return { output: lines.join('\n'), exitCode: failed ? 1 : 0 };
}

export interface SpecCompileOptions { input: string; package: string; ecosystem: 'npm'|'pypi'; from: string; to: string; language: 'ts'|'py'; out: string; provider?: string; repository?: string; model?: string }
function mediaType(path: string): 'text/plain'|'text/markdown'|'application/json'|'application/yaml' {
  if (/\.md$/i.test(path)) return 'text/markdown';
  if (/\.json$/i.test(path)) return 'application/json';
  if (/\.ya?ml$/i.test(path)) return 'application/yaml';
  return 'text/plain';
}
async function readEnvelope(path: string): Promise<ChangeSpecEnvelope> { return validateContract('ChangeSpecEnvelope', JSON.parse(await readFile(resolve(path), 'utf8')) as unknown); }
async function readReport(path: string): Promise<ChangeSpecCompilationReport> { return validateContract('ChangeSpecCompilationReport', JSON.parse(await readFile(resolve(path), 'utf8')) as unknown); }
async function writeEnvelope(path: string, envelope: ChangeSpecEnvelope): Promise<void> { await mkdir(dirname(resolve(path)), { recursive: true }); await writeFile(resolve(path), deterministicJson(envelope)); }

export async function specCompile(options: SpecCompileOptions): Promise<{ output: string; exitCode: number }> {
  const sourcePath = resolve(options.input);
  const source = await readFile(sourcePath, 'utf8');
  const packet = buildInputPacket({ ...(options.provider ? { providerHint: options.provider } : {}), dependency: { ecosystem: options.ecosystem, package: options.package, fromVersion: options.from, toVersion: options.to }, supportedLanguages: [options.language], sources: [{ id: basename(sourcePath), declaredUri: sourcePath, mediaType: mediaType(sourcePath), content: source }] });
  const key = geminiApiKey();
  if (!key) return { output: 'MODEL_UNAVAILABLE: set GEMINI_API_KEY in the trusted compilation environment.', exitCode: 2 };
  const output = resolve(options.out);
  const directory = extname(output) === '.json' ? dirname(output) : output;
  const envelopePath = extname(output) === '.json' ? output : join(directory, 'draft-envelope.json');
  const result = await compileChangeSpec({ packet, model: createGeminiStructuredModel(key, options.model), repositoryRoot: resolve(options.repository ?? process.cwd()), cacheDirectory: join(directory, 'cache') });
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(join(directory, 'input-packet.json'), deterministicJson(packet)),
    writeFile(join(directory, 'source-manifest.json'), deterministicJson(result.envelope.sourceProvenance)),
    writeFile(join(directory, 'model-response.json'), deterministicJson({ raw: result.rawResponse, sha256: result.envelope.compilerProvenance.rawResponseHash })),
    writeFile(join(directory, 'candidate.json'), deterministicJson(result.envelope.candidate)),
    writeFile(join(directory, 'compilation-report.json'), deterministicJson(result.report)),
    writeEnvelope(envelopePath, result.envelope),
  ]);
  return { output: `Compiled untrusted candidate to ${envelopePath}\nstatus: ${result.report.status}\nbundle: ${result.envelope.bundleHash}`, exitCode: ['invalid', 'binding_failed'].includes(result.report.status) ? 1 : 0 };
}

export async function specInspect(path: string): Promise<{ output: string; exitCode: number }> {
  const envelope = await readEnvelope(path);
  const summary = { status: envelope.status, provider: envelope.candidate.provider, title: envelope.candidate.title, dependency: envelope.dependencyBinding, changes: envelope.candidate.changes.map(change => ({ object: change.object, removed: change.removedPath ?? change.removedSymbol, replacement: change.replacement, citations: change.citations })), unknowns: envelope.candidate.unknowns, warnings: [...(envelope.candidate.suspectedInjection ? ['suspected injection'] : []), ...(envelope.candidate.abstain ? ['model abstained'] : [])], projectBinding: envelope.projectBinding, evidenceBinding: envelope.evidenceBinding, approval: envelope.approval ?? null, bundleHash: envelope.bundleHash };
  return { output: deterministicJson(summary).trimEnd(), exitCode: 0 };
}

export async function specBindFixtures(path: string, reportPath: string, fixtures: string, pair: string, heldout?: string, out?: string): Promise<{ output: string; exitCode: number }> {
  const envelope = await readEnvelope(path);
  const bound = bindEnvelopeEvidence(envelope, await createEvidenceBinding({ fixturesRoot: resolve(fixtures), pair, ...(heldout ? { heldoutPair: heldout } : {}), dependencyBinding: envelope.dependencyBinding, mode: 'product' }));
  const refreshed = refreshCompilationReport(bound, await readReport(reportPath));
  const target = resolve(out ?? path); await writeEnvelope(target, refreshed.envelope); await writeFile(resolve(reportPath), deterministicJson(refreshed.report));
  return { output: `Bound fixture evidence and wrote ${target}\nreport: ${resolve(reportPath)}\nstatus: ${refreshed.report.status}\nbundle: ${refreshed.envelope.bundleHash}`, exitCode: refreshed.report.status === 'ready_for_approval' ? 0 : 1 };
}

export async function specApprove(path: string, reportPath: string, actor: string, out: string): Promise<{ output: string; exitCode: number }> {
  const envelope = await readEnvelope(path); const report = await readReport(reportPath);
  const readiness = evaluateApprovalReadiness(envelope, report);
  if (!readiness.ready) return { output: `Approval blocked:\n- ${readiness.blockers.join('\n- ')}`, exitCode: 1 };
  const approved = approveEnvelope({ envelope, report, actor }); await writeEnvelope(resolve(out), approved);
  return { output: `Approved immutable ChangeSpec envelope at ${resolve(out)}\nbundle: ${approved.bundleHash}`, exitCode: 0 };
}

export async function specRevoke(path: string, out?: string): Promise<{ output: string; exitCode: number }> {
  const revoked = revokeEnvelope(await readEnvelope(path)); const target = resolve(out ?? path); await writeEnvelope(target, revoked);
  return { output: `Revoked ChangeSpec envelope at ${target}\nbundle: ${revoked.bundleHash}`, exitCode: 0 };
}

export async function specDraft(url: string, provider: string, outPath?: string): Promise<{ output: string; exitCode: number }> {
  const spec = await draftSpec({ url, provider });
  const yaml = await renderDraftYaml(spec);
  const dest = outPath ?? join(process.cwd(), '.isotope/drafts', `${spec.id}.yaml`);
  await mkdir(resolve(dest, '..'), { recursive: true });
  await writeFile(dest, yaml);
  return { output: `Wrote draft ChangeSpec ${spec.id} to ${dest}\nverified_by: draft — will not enter L1 until a human recertifies it.`, exitCode: 0 };
}

export async function fixturesNormalize(raw?: string, out?: string, pairId?: string): Promise<{ output: string; exitCode: number }> {
  const rawDirectory = resolve(raw ?? join(__dirname, '../../../fixtures/raw'));
  const normalizedDirectory = resolve(out ?? join(__dirname, '../../../fixtures/normalized'));
  try {
    const result = await normalizeFixtures({ rawDirectory, normalizedDirectory, pairId: pairId ?? '' });
    return { output: `Normalized pair ${result.pairId} without reshaping fields.`, exitCode: 0 };
  } catch (error) {
    return { output: `No raw fixture pair to copy (${error instanceof Error ? error.message : error}).`, exitCode: 0 };
  }
}
