import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import { validateContract, type ChangeSpecCandidate, type DependencyBinding, type ProjectBinding } from '@isotope/core';
import { checkResolverCompatibility as checkTs } from '@isotope/resolver-ts';
import { checkResolverCompatibility as checkPy } from '@isotope/resolver-py';
import { lowerCandidateForCompatibility } from './lower';

export async function bindProject(candidate: ChangeSpecCandidate, dependencyBinding: DependencyBinding, repositoryRoot: string): Promise<ProjectBinding> {
  const root = await realpath(resolve(repositoryRoot));
  let configText: string;
  try { configText = await readFile(join(root, 'isotope.yml'), 'utf8'); }
  catch { return { status: 'unbound', repositoryRootHash: createHash('sha256').update(root).digest('hex'), matchedRoots: [], diagnostics: ['isotope.yml is required for resolver-backed binding'] }; }
  let config;
  try { config = validateContract('IsotopeConfig', parse(configText) as unknown); }
  catch (error) { return { status: 'unbound', repositoryRootHash: createHash('sha256').update(configText).digest('hex'), matchedRoots: [], diagnostics: [`Invalid isotope.yml: ${(error as Error).message}`] }; }
  let language: 'ts'|'py';
  if (config.language === 'auto') {
    const py = config.entryPoints.some(entry => entry.file.endsWith('.py')); const ts = config.entryPoints.some(entry => !entry.file.endsWith('.py'));
    if (py && ts) return { status: 'ambiguous', repositoryRootHash: createHash('sha256').update(configText).digest('hex'), matchedRoots: [], diagnostics: ['language:auto resolves to both TypeScript and Python'] };
    language = py ? 'py' : 'ts';
  } else language = config.language;
  if (!candidate.taintRoots.some(rootCandidate => rootCandidate.language === language)) return { status: 'unbound', repositoryRootHash: createHash('sha256').update(configText).digest('hex'), language, matchedRoots: [], diagnostics: [`Candidate has no ${language} root`] };
  const candidateSpec = lowerCandidateForCompatibility(candidate, dependencyBinding);
  const result = language === 'py' ? await checkPy({ repositoryRoot: root, config, candidateSpec }) : await checkTs({ repositoryRoot: root, config, candidateSpec });
  const status = result.status === 'compatible' ? 'bound' : result.status === 'ambiguous' ? 'ambiguous' : 'unbound';
  const sourceFiles = [...new Set(result.matchedRoots.map(match => match.file))].sort();
  const sourceHashes = await Promise.all(sourceFiles.map(async file => ({ file, sha256: createHash('sha256').update(await readFile(join(root, file))).digest('hex') })));
  const repositoryRootHash = createHash('sha256').update(JSON.stringify({ config: configText, sources: sourceHashes, matches: result.matchedRoots })).digest('hex');
  return { status, repositoryRootHash, language, module: result.module, matchedRoots: result.matchedRoots.map(match => match.pattern), matches: result.matchedRoots, diagnostics: result.diagnostics };
}
