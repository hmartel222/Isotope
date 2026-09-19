import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { draftSpec, listSpecFiles, loadHumanSpecs, renderDraftYaml, normalizeFixtures } from '@isotope/changespec';
import { validateContract } from '@isotope/core';
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
      const spec = validateContract('ChangeSpec', parse(await readFile(resolve(file), 'utf8')) as unknown);
      lines.push(`${file}: OK (${spec.id}, verified_by=${spec.verified_by})`);
      if (spec.verified_by === 'draft') lines.push('  note: draft specs never enter L1');
    } catch (error) {
      failed = true;
      lines.push(`${file}: INVALID ${error instanceof Error ? error.message : error}`);
    }
  }
  return { output: lines.join('\n'), exitCode: failed ? 1 : 0 };
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
