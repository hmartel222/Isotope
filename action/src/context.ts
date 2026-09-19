import { readFile } from 'node:fs/promises';

const SHA = /^[0-9a-f]{40}$/i;
export interface PullRequestContext { owner: string; repo: string; pullNumber: number; baseSha: string; headSha: string; actor: string; }
function requiredSha(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA.test(value)) throw new Error(`${label} must be a full 40-character Git SHA`); return value;
}
export function parsePullRequestPayload(value: unknown): PullRequestContext {
  if (!value || typeof value !== 'object') throw new Error('GitHub event payload must be an object');
  const payload = value as Record<string, any>; const pr = payload.pull_request;
  if (!pr || typeof pr !== 'object') throw new Error('Isotope requires a pull_request event or explicit base/head inputs');
  const fullName = payload.repository?.full_name;
  if (typeof fullName !== 'string' || !fullName.includes('/')) throw new Error('GitHub repository owner/name is missing');
  const pullNumber = Number(payload.number); if (!Number.isSafeInteger(pullNumber) || pullNumber < 1) throw new Error('Pull request number is invalid');
  const [owner, repo] = fullName.split('/', 2) as [string, string];
  return { owner, repo, pullNumber, baseSha: requiredSha(pr.base?.sha, 'pull_request.base.sha'), headSha: requiredSha(pr.head?.sha, 'pull_request.head.sha'), actor: String(payload.sender?.login ?? '') };
}
export async function loadActionContext(inputs: { base?: string; head?: string; pullNumber?: string }): Promise<PullRequestContext> {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath) {
    const payload = JSON.parse(await readFile(eventPath, 'utf8')) as Record<string, unknown>;
    if (payload.pull_request) return parsePullRequestPayload(payload);
  }
  const repository = process.env.GITHUB_REPOSITORY;
  if (!inputs.base || !inputs.head || !repository?.includes('/')) throw new Error('Outside pull_request events, provide base and head inputs and GITHUB_REPOSITORY');
  const pullNumber = Number(inputs.pullNumber); if (!Number.isSafeInteger(pullNumber) || pullNumber < 1) throw new Error('Explicit pr-number is required for reporting');
  const [owner, repo] = repository.split('/', 2) as [string, string];
  return { owner, repo, pullNumber, baseSha: requiredSha(inputs.base, 'base'), headSha: requiredSha(inputs.head, 'head'), actor: process.env.GITHUB_ACTOR ?? '' };
}
