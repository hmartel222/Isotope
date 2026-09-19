import { resolve, relative, isAbsolute, join } from 'node:path';
import type { CodeVersion } from './contracts';

export function assertWithinRoot(root: string, path: string): string {
  const absolute = resolve(path);
  const rel = relative(resolve(root), absolute);
  if (!rel || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) throw new Error(`Artifact path must be a file below ${root}: ${path}`);
  return absolute;
}
function component(value: string): string {
  if (!value || value === '.' || value === '..' || /[/\\\u0000-\u001f]/.test(value)) throw new Error(`Unsafe artifact identifier: ${JSON.stringify(value)}`);
  // Encode delimiters too, so different ID tuples cannot overwrite each other.
  return encodeURIComponent(value).replace(/[.!'()*]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}
/** Pure, portable reference construction; no platform, environment, cwd or filesystem reads. */
export function signatureArtifactRef(key: { entryPointId: string; codeVersion: CodeVersion; fixturePair: string; payloadVersion: string; runIndex: number }): string {
  if (!Number.isSafeInteger(key.runIndex) || key.runIndex < 0) throw new Error('runIndex must be a nonnegative safe integer');
  return `signatures/${component(key.codeVersion)}/${component(key.fixturePair)}/${component(key.entryPointId)}.${component(key.payloadVersion)}.${key.runIndex}.json`;
}
export function artifactPaths(projectRoot: string) {
  const root = resolve(projectRoot, '.isotope');
  const at = (...parts: string[]) => assertWithinRoot(root, join(root, ...parts));
  return {
    root,
    selectedSpecs: at('selected-specs.json'), bdg: at('bdg.json'), diffReport: at('diff-report.json'), verdict: at('verdict.json'), report: at('isotope-report.json'),
    signature: (key: Parameters<typeof signatureArtifactRef>[0]) => at(signatureArtifactRef(key)),
    evidencePacket: (ep: string, divergence: string) => at('evidence-packets', `${component(ep)}.${component(divergence)}.json`),
    reasoning: (ep: string, divergence: string, vote = 0) => {
      if (!Number.isSafeInteger(vote) || vote < 0) throw new Error('vote must be a nonnegative safe integer');
      return at('reasoning', `${component(ep)}.${component(divergence)}.${vote}.json`);
    },
    cache: (key: string) => at('cache', `${component(key)}.json`),
    comparison: (ep: string, code: CodeVersion, pair: string, kind: 'baseline' | 'secondary' | 'original') => at('diffs', component(code), component(pair), `${component(ep)}.${component(kind)}.json`),
    repairPacket: (id: string) => at('repair', 'packets', `${component(id)}.json`),
    candidate: (id: string) => at('repair', 'candidates', `${component(id)}.json`),
    proposal: (id: string) => at('repair', 'proposals', `${component(id)}.json`),
    verification: (id: string) => at('repair', 'verification', `${component(id)}.json`),
    verifiedRepair: at('repair', 'verified-repair.json'),
    directories: ['signatures', 'diffs', 'evidence-packets', 'reasoning', 'cache', 'repair/packets', 'repair/candidates', 'repair/proposals', 'repair/verification'].map(dir => at(dir)),
  };
}
export type ArtifactPaths = ReturnType<typeof artifactPaths>;
