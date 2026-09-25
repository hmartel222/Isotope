import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const files = ['selected-specs.json', 'bdg.json', 'diff-report.json', 'verdict.json', 'isotope-report.json'];
function normalize(value, context = '') {
  if (Array.isArray(value)) return value.map((item, index) => normalize(item, `${context}/${index}`));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (['bundleHash', 'approvedAt', 'durationMs'].includes(key)) continue;
    if (key === 'specId') { out[key] = '<compiled-spec>'; continue; }
    if (context.endsWith('/specs/0') && ['id', 'source', 'verified_at'].includes(key)) { out[key] = `<${key}>`; continue; }
    out[key] = normalize(raw, `${context}/${key}`);
  }
  return out;
}
function differences(a, b, path = '$', result = []) {
  if (Object.is(a, b)) return result;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') { result.push({ path, golden: a, compiled: b }); return result; }
  if (Array.isArray(a) !== Array.isArray(b)) { result.push({ path, golden: a, compiled: b }); return result; }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of [...keys].sort()) differences(a[key], b[key], `${path}/${key}`, result);
  return result;
}
export function compareArtifacts(provider, golden, compiled) {
  const unexpectedDifferences = differences(normalize(golden), normalize(compiled));
  return { provider, equivalent: unexpectedDifferences.length === 0, comparedArtifacts: Object.keys(golden).sort(), allowedDifferences: ['compiled spec identity', 'source', 'approval date', 'bundle hash', 'durationMs'], unexpectedDifferences };
}
async function loadRun(directory) {
  const result = {};
  for (const file of files) try { result[file] = JSON.parse(await readFile(join(directory, file), 'utf8')); } catch { /* optional */ }
  const signatureDir = join(directory, 'signatures');
  try { for (const file of (await readdir(signatureDir, { recursive: true })).filter(file => file.endsWith('.json')).sort()) result[`signatures/${file}`] = JSON.parse(await readFile(join(signatureDir, file), 'utf8')); } catch { /* optional */ }
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const [, , goldenPath, compiledPath, outputPath] = process.argv;
  if (!goldenPath || !compiledPath || !outputPath) throw new Error('Usage: compare-changespec-runs.mjs <golden-dir> <compiled-dir> <out.json>');
  const report = compareArtifacts(basename(resolve(compiledPath)), await loadRun(resolve(goldenPath)), await loadRun(resolve(compiledPath)));
  await writeFile(resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`);
  if (!report.equivalent) process.exitCode = 1;
}
