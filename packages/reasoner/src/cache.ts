import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { artifactPaths, deterministicJson, type ReasoningResult } from '@isotope/core';
import { DEFAULT_REASONER_MODEL, REASONER_PROMPT_VERSION, REASONING_SCHEMA_VERSION } from './prompt';

export interface CachedVotes { voteA: ReasoningResult; voteB: ReasoningResult }

export function cacheKey(packetHash: string, model = DEFAULT_REASONER_MODEL): string {
  return createHash('sha256').update(`${packetHash}|${model}|${REASONER_PROMPT_VERSION}|${REASONING_SCHEMA_VERSION}`).digest('hex');
}

export async function readReasonerCache(artifactRoot: string, key: string): Promise<CachedVotes | null> {
  try {
    const value = JSON.parse(await readFile(artifactPaths(artifactRoot).cache(key), 'utf8')) as CachedVotes;
    if (!value?.voteA || !value?.voteB) return null;
    return value;
  } catch { return null; }
}

export async function writeReasonerCache(artifactRoot: string, key: string, votes: CachedVotes): Promise<void> {
  const path = artifactPaths(artifactRoot).cache(key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, deterministicJson(votes), 'utf8');
}
