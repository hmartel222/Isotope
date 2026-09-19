import type { BDG, DiffReport, IsotopeReport, JsonValue, SelectedSpecs, Signature, Verdict } from '@isotope/core';

export const REPORT_MARKER = '<!-- isotope-report -->';
const MAX_TEXT = 240;
export interface ReportEvidence { report: IsotopeReport; selected: SelectedSpecs; bdg: BDG | null; diffs: DiffReport[]; signatures: Signature[]; }
export interface Annotation { path: string; start_line: number; end_line: number; annotation_level: 'failure' | 'warning' | 'notice'; title: string; message: string; }
export type CheckConclusion = 'success' | 'failure' | 'neutral';

function clean(value: unknown, limit = MAX_TEXT): string {
  return String(value ?? '').replace(/<!--/g, '&lt;!--').replace(/-->/g, '--&gt;').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').slice(0, limit);
}
function code(value: unknown, limit = MAX_TEXT): string { return `\`${clean(value, limit).replace(/`/g, '\\`')}\``; }
function display(value: JsonValue): string {
  if (value === '__undefined__') return 'undefined';
  const text = JSON.stringify(value); return clean(text.length > 160 ? `${text.slice(0, 157)}...` : text, 180);
}
function transition(selected: SelectedSpecs): string {
  const dep = selected.dependencyChanges[0]; const spec = selected.specs[0];
  if (!dep || !spec) return 'No relevant dependency transition selected.';
  return `${code(dep.package)} ${code(dep.from_version)} → ${code(dep.to_version)} crosses ${code(spec.id)}.`;
}
function counts(evidence: ReportEvidence): string {
  const sites = evidence.bdg?.affectedSites.length ?? 0; const handlers = evidence.bdg?.entryPoints.length ?? 0;
  return `${handlers} handler${handlers === 1 ? '' : 's'} checked · ${sites} affected site${sites === 1 ? '' : 's'}`;
}
function firstDivergence(evidence: ReportEvidence) { return evidence.diffs.flatMap(d => d.divergences)[0]; }
function location(evidence: ReportEvidence): string | null {
  const site = evidence.bdg?.affectedSites[0]; return site ? `${code(site.location.file)}:${site.location.line}` : null;
}
function ambiguityQuestion(evidence: ReportEvidence): string | null {
  const marked = evidence.diffs.some(d => d.divergences.some(x => x.ambiguityCandidate));
  if (!marked) return null;
  return evidence.selected.specs.flatMap(s => s.changes).find(c => c.ambiguity)?.ambiguity?.question ?? null;
}

/** Pure, bounded Markdown rendering. SKIP intentionally returns null. */
export function renderPrComment(evidence: ReportEvidence): string | null {
  const verdict = evidence.report.verdict.verdict;
  if (verdict === 'SKIP') return null;
  const lines = [REPORT_MARKER, ''];
  if (verdict === 'FAIL' || verdict === 'FAIL_REASONED') {
    lines.push('### ❌ Isotope — incompatibility detected', '', transition(evidence.selected));
    const at = location(evidence); if (at) lines.push('', `**${at}**`, 'silent break · mechanically determined');
    const divergence = firstDivergence(evidence);
    if (divergence) lines.push('', `Observable ${code(divergence.sinkKind ?? 'handler')} changed at ${code(divergence.pointer)}.`, '', '| | old | new |', '|---|---|---|', `| value | ${code(display(divergence.old), 190)} | ${code(display(divergence.new), 190)} |`);
    if (evidence.signatures.length && evidence.signatures.every(s => s.threw === null)) lines.push('', 'Both repeated old/new executions completed normally.');
    const verified = evidence.report.verifiedRepairs[0];
    if (verified) {
      const diff = verified.diff.slice(0, 8000).replace(/```/g, '``\u200b`');
      lines.push('', '### ✅ Verified repair available', '', '```diff', diff.trimEnd(), '```', '', 'Verification:',
        '- original verdict: FAIL', '- patched planning fixture: PASS', '- held-out fixture: PASS', '- provider→sink flow preserved',
        '', 'Applied only in an isolated workspace. Nothing was committed, pushed, or merged.');
    } else if (evidence.report.repairVerifications.length) {
      const rejected = evidence.report.repairVerifications[0]!;
      lines.push('', `A candidate repair was evaluated but did not satisfy Isotope's verification criteria.`, `Reason: ${code(rejected.outcome)} — ${clean(rejected.reason, 500)}`);
    }
  } else if (verdict === 'PASS' || verdict === 'PASS_REASONED') {
    lines.push('### ✅ Isotope — compatible', '', transition(evidence.selected), '', `${counts(evidence)}.`, 'No behavioral incompatibility found.');
  } else if (verdict === 'ESCALATE') {
    lines.push('### ⚠️ Isotope needs a decision', '', transition(evidence.selected), '', 'Behavior changed, but the change is not mechanically classifiable.');
    const divergence = firstDivergence(evidence); if (divergence) lines.push('', `Affected behavior: ${code(divergence.pointer)} changed from ${code(display(divergence.old))} to ${code(display(divergence.new))}.`);
    const question = ambiguityQuestion(evidence); if (question) lines.push('', `Decision needed: ${clean(question, 500)}`);
    lines.push('', 'Automated semantic reasoning is disabled in this build.', 'Manual review required.');
  } else {
    lines.push('### ⚠️ Isotope could not establish stable behavior', '', 'The handler produced different results across repeated executions.', '', 'No compatibility verdict was inferred.');
  }
  lines.push('', counts(evidence), '', 'Full evidence is available in the `.isotope/` workflow artifact.');
  return lines.join('\n').slice(0, 20_000);
}

export function renderCheckSummary(evidence: ReportEvidence): string {
  const repair = evidence.report.verifiedRepairs.length ? ['', 'A verified deterministic repair is available; the incompatibility remains blocking until a human applies it.'] : [];
  return [`### Isotope: ${evidence.report.verdict.verdict}`, '', transition(evidence.selected), '', counts(evidence), ...repair, '', 'Artifacts: `.isotope/`'].join('\n');
}
export function mapVerdictToConclusion(verdict: Verdict): CheckConclusion {
  if (verdict === 'FAIL' || verdict === 'FAIL_REASONED' || verdict === 'ESCALATE') return 'failure';
  if (verdict === 'INDETERMINATE') return 'neutral';
  return 'success';
}
export function buildAnnotations(evidence: ReportEvidence, limit = 25): Annotation[] {
  const verdict = evidence.report.verdict.verdict;
  if (verdict === 'SKIP' || verdict === 'PASS' || verdict === 'PASS_REASONED' || !evidence.bdg) return [];
  const level = verdict === 'FAIL' || verdict === 'FAIL_REASONED' ? 'failure' : 'warning';
  return [...evidence.bdg.affectedSites].sort((a,b) => a.location.file.localeCompare(b.location.file) || a.location.line - b.location.line).slice(0, Math.max(0, Math.min(limit, 50))).map(site => ({
    path: clean(site.location.file, 500), start_line: site.location.line, end_line: site.location.endLine ?? site.location.line,
    annotation_level: level, title: verdict === 'ESCALATE' ? 'Isotope needs a decision' : verdict === 'INDETERMINATE' ? 'Isotope unstable behavior' : 'Isotope incompatibility',
    message: clean(`${site.provenance.provider} ${site.provenance.confidence}-confidence affected flow; product verdict ${verdict}.`, 500),
  }));
}

export interface GitHubClient {
  listIssueComments(input: { owner: string; repo: string; issue_number: number; per_page: number }): Promise<{ data: Array<{ id: number; body?: string | null; user?: { login?: string | null; type?: string | null } | null }> }>;
  createIssueComment(input: { owner: string; repo: string; issue_number: number; body: string }): Promise<unknown>;
  updateIssueComment(input: { owner: string; repo: string; comment_id: number; body: string }): Promise<unknown>;
  createCheck(input: { owner: string; repo: string; name: string; head_sha: string; status: 'completed'; conclusion: CheckConclusion; output: { title: string; summary: string; annotations: Annotation[] } }): Promise<unknown>;
}
export interface PublishResult { comment: 'created' | 'updated' | 'skipped' | 'failed'; check: 'created' | 'failed'; errors: string[]; }

/** GitHub adapter: reporting failures never alter the product verdict. */
export async function publishGitHubReport(input: { client: GitHubClient; owner: string; repo: string; pullNumber: number; headSha: string; evidence: ReportEvidence }): Promise<PublishResult> {
  const result: PublishResult = { comment: 'skipped', check: 'failed', errors: [] };
  const body = renderPrComment(input.evidence);
  if (body) try {
    const comments = await input.client.listIssueComments({ owner: input.owner, repo: input.repo, issue_number: input.pullNumber, per_page: 100 });
    const owned = comments.data.filter(c => c.body?.includes(REPORT_MARKER) && (c.user?.login === 'github-actions[bot]' || c.user?.type === 'Bot'));
    if (owned.length === 1) { await input.client.updateIssueComment({ owner: input.owner, repo: input.repo, comment_id: owned[0]!.id, body }); result.comment = 'updated'; }
    else { await input.client.createIssueComment({ owner: input.owner, repo: input.repo, issue_number: input.pullNumber, body }); result.comment = 'created'; }
  } catch (error) { result.comment = 'failed'; result.errors.push(`comment: ${clean(error, 500)}`); }
  try {
    const verdict = input.evidence.report.verdict.verdict;
    await input.client.createCheck({ owner: input.owner, repo: input.repo, name: 'Isotope behavioral diff', head_sha: input.headSha, status: 'completed', conclusion: mapVerdictToConclusion(verdict), output: { title: `Isotope: ${verdict}`, summary: renderCheckSummary(input.evidence), annotations: buildAnnotations(input.evidence) } });
    result.check = 'created';
  } catch (error) { result.errors.push(`check: ${clean(error, 500)}`); }
  return result;
}
