import type { GitHubClient } from '@isotope/reporter';

export function githubClient(token: string): GitHubClient {
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`https://api.github.com${path}`, { method, headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28', 'user-agent': 'isotope-action' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok) throw new Error(`GitHub API ${method} ${path} returned ${response.status}: ${(await response.text()).slice(0, 500)}`);
    return response.status === 204 ? {} : await response.json() as unknown;
  };
  return {
    async listIssueComments(x) { return { data: await call('GET', `/repos/${encodeURIComponent(x.owner)}/${encodeURIComponent(x.repo)}/issues/${x.issue_number}/comments?per_page=${x.per_page}`) as any[] }; },
    async createIssueComment(x) { return call('POST', `/repos/${encodeURIComponent(x.owner)}/${encodeURIComponent(x.repo)}/issues/${x.issue_number}/comments`, { body: x.body }); },
    async updateIssueComment(x) { return call('PATCH', `/repos/${encodeURIComponent(x.owner)}/${encodeURIComponent(x.repo)}/issues/comments/${x.comment_id}`, { body: x.body }); },
    async createCheck(x) { return call('POST', `/repos/${encodeURIComponent(x.owner)}/${encodeURIComponent(x.repo)}/check-runs`, x); },
  };
}
