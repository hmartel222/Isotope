#!/usr/bin/env node
/**
 * Local Snowflake REST ping / row capture using a Programmatic Access Token.
 * CI must never invoke this. --ping lists databases (no warehouse).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_ROWS = 20;
const STATEMENT_TIMEOUT_S = 30;
const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|MERGE|COPY|PUT|GET|CREATE|DROP|UNDROP|TRUNCATE|GRANT|REVOKE|CALL|BEGIN|COMMIT|ROLLBACK|ALTER)\b/i;

function parseArgs(argv) {
  const out = { side: '', pair: 'snowflake-live', outDir: '', sql: '', ping: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--ping') out.ping = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--side' && next) { out.side = next; i++; }
    else if (arg === '--pair' && next) { out.pair = next; i++; }
    else if (arg === '--out' && next) { out.outDir = next; i++; }
    else if (arg === '--sql' && next) { out.sql = next; i++; }
  }
  return out;
}

async function loadDotEnv() {
  try {
    const text = await readFile(join(repoRoot, '.env'), 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
  }
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    const hint = name === 'SNOWFLAKE_ACCOUNT'
      ? ' Use the org-account host from Snowsight (the part before .snowflakecomputing.com).'
      : name === 'SNOWFLAKE_PAT'
        ? ' Paste the PAT into gitignored .env, or keep it in the Downloads token file and re-run the copy step.'
        : '';
    throw Object.assign(new Error(`Missing ${name}.${hint}`), { code: 'MISSING_CREDS' });
  }
  return value;
}

function assertSafeOut(outRoot) {
  const resolved = resolve(outRoot);
  const forbidden = ['corpus', 'fixtures', 'specs', 'packages', 'tests'].map((dir) => join(repoRoot, dir));
  for (const dir of forbidden) {
    if (resolved === dir || resolved.startsWith(`${dir}/`)) {
      throw new Error(`Refusing to write captures into ${dir}. Use .isotope/captures/ (gitignored).`);
    }
  }
  return resolved;
}

function cheapSql(sql) {
  const trimmed = sql.trim().replace(/;+\s*$/, '');
  if (!trimmed) throw Object.assign(new Error('Empty SQL'), { code: 'BAD_ARGS' });
  if (trimmed.includes(';')) throw Object.assign(new Error('One statement only.'), { code: 'BAD_ARGS' });
  if (FORBIDDEN.test(trimmed)) {
    throw Object.assign(new Error('Only cheap SELECT/SHOW/DESCRIBE statements are allowed (no COPY/DDL/DML).'), { code: 'BAD_ARGS' });
  }
  if (!/^(SELECT|SHOW|DESC|DESCRIBE)\b/i.test(trimmed)) {
    throw Object.assign(new Error('SQL must start with SELECT, SHOW, or DESCRIBE.'), { code: 'BAD_ARGS' });
  }
  if (/^SELECT\b/i.test(trimmed) && !/\bLIMIT\s+\d+\b/i.test(trimmed) && !/\bCURRENT_/i.test(trimmed)) {
    return `${trimmed} LIMIT ${MAX_ROWS}`;
  }
  const limit = trimmed.match(/\bLIMIT\s+(\d+)\b/i);
  if (limit && Number(limit[1]) > MAX_ROWS) {
    throw Object.assign(new Error(`LIMIT must be <= ${MAX_ROWS}`), { code: 'BAD_ARGS' });
  }
  return trimmed;
}

function accountHost() {
  const explicit = process.env.SNOWFLAKE_HOST;
  if (explicit) return explicit.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const account = requiredEnv('SNOWFLAKE_ACCOUNT').replace(/^https?:\/\//, '').replace(/\.snowflakecomputing\.com.*$/i, '');
  return `${account}.snowflakecomputing.com`;
}

function authHeaders() {
  return {
    Authorization: `Bearer ${requiredEnv('SNOWFLAKE_PAT')}`,
    'X-Snowflake-Authorization-Token-Type': 'PROGRAMMATIC_ACCESS_TOKEN',
    Accept: 'application/json',
    'User-Agent': 'isotope-local-ping/0.1',
  };
}

async function restJson(method, path, body) {
  const url = `https://${accountHost()}${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      ...authHeaders(),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 500) }; }
  if (!response.ok) {
    const message = json?.message || json?.code || response.statusText;
    throw new Error(`Snowflake REST ${response.status} ${message}`);
  }
  return json;
}

function printHelp() {
  process.stdout.write(`Cheap local Snowflake REST connection (PAT). Never add a credit card.

  node tools/capture-snowflake.mjs --ping
  node tools/capture-snowflake.mjs --side old|new [--sql "select 1 as n"]

.env:
  SNOWFLAKE_ACCOUNT=org-account     # host before .snowflakecomputing.com
  SNOWFLAKE_PAT=<token secret>

--ping is GET /api/v2/databases (no warehouse). SQL uses /api/v2/statements and can resume XS.
`);
}

function rowsFromStatement(result) {
  const cols = (result?.resultSetMetaData?.rowType || []).map((c) => c.name);
  const data = result?.data || [];
  return data.slice(0, MAX_ROWS).map((row) => {
    const object = {};
    cols.forEach((name, i) => { object[name] = row[i]; });
    return object;
  });
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

try {
  await loadDotEnv();
  const ping = args.ping || !args.side;
  if (!ping && args.side !== 'old' && args.side !== 'new') {
    throw Object.assign(new Error('Pass --ping, or --side old|new'), { code: 'BAD_ARGS' });
  }
  if (ping && !args.side && !args.sql && !process.env.SNOWFLAKE_SQL) {
    const databases = await restJson('GET', `/api/v2/databases?limit=${MAX_ROWS}`);
    const names = (Array.isArray(databases) ? databases : databases?.databases || databases?.data || [])
      .map((item) => item?.name || item).filter(Boolean);
    process.stdout.write(`ok PAT ping; ${names.length} database(s) visible (no warehouse)\n`);
    process.stdout.write(`${JSON.stringify(names, null, 2)}\n`);
    process.exit(0);
  }
  const sql = cheapSql(args.sql || process.env.SNOWFLAKE_SQL || '');
  const result = await restJson('POST', `/api/v2/statements?requestId=${randomUUID()}`, {
    statement: sql,
    timeout: STATEMENT_TIMEOUT_S,
    ...(process.env.SNOWFLAKE_WAREHOUSE ? { warehouse: process.env.SNOWFLAKE_WAREHOUSE } : {}),
    ...(process.env.SNOWFLAKE_DATABASE ? { database: process.env.SNOWFLAKE_DATABASE } : {}),
    ...(process.env.SNOWFLAKE_SCHEMA ? { schema: process.env.SNOWFLAKE_SCHEMA } : {}),
    ...(process.env.SNOWFLAKE_ROLE ? { role: process.env.SNOWFLAKE_ROLE } : {}),
  });
  const rows = rowsFromStatement(result);
  process.stdout.write(`ok ${rows.length} row(s) via SQL API\n`);
  if (ping && !args.side) {
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    process.exit(0);
  }
  const outRoot = assertSafeOut(args.outDir || join(repoRoot, '.isotope/captures/snowflake'));
  const rawDir = join(outRoot, args.pair);
  await mkdir(rawDir, { recursive: true });
  await writeFile(join(rawDir, `${args.side}.json`), `${JSON.stringify({ rows }, null, 2)}\n`);
  await writeFile(join(rawDir, `${args.side}.meta.json`), `${JSON.stringify({
    capturedAt: new Date().toISOString(),
    pair: args.pair,
    side: args.side,
    synthetic: false,
    sql,
    maxRows: MAX_ROWS,
  }, null, 2)}\n`);
  process.stdout.write(`Wrote ${join(rawDir, `${args.side}.json`)}\n`);
} catch (error) {
  const code = error && error.code;
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exit(code === 'MISSING_CREDS' || code === 'BAD_ARGS' ? 2 : 1);
}
