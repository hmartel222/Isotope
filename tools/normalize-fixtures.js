#!/usr/bin/env node
/**
 * Isotope fixture normalizer (v3 §1.5, §13–§17).
 *
 * Permitted operations, and nothing else:
 *   1. record API/version metadata;
 *   2. replace live identifiers with deterministic aliases, consistent WITHIN a
 *      pair and distinct ACROSS pairs;
 *   3. emit normalized JSON;
 *   4. record the SHA-256 of the raw input.
 *
 * Forbidden, and mechanically prevented by assertOnlyAliased():
 *   inserting, removing, moving, reshaping or inferring any field; reordering
 *   keys or arrays; altering any number, boolean or null; translating the old
 *   shape into the new shape or vice versa.
 *
 * Every difference between a raw byte stream and its normalized output must be
 * explainable by the recorded alias map. If it is not, this tool refuses to
 * write. Normalization removes identity churn. It does not manufacture
 * compatibility evidence.
 *
 * Usage:
 *   node tools/normalize-fixtures.js \
 *     --pair sub-updated-single --role planning --namespace A \
 *     --old fixtures/raw/acacia/customer.subscription.updated.<ts>.<sha>.json \
 *     --new fixtures/raw/dahlia/customer.subscription.updated.<ts>.<sha>.json \
 *     --capture-method B
 *
 *   node tools/normalize-fixtures.js --verify            # all normalized pairs
 *   node tools/normalize-fixtures.js --verify --pair sub-updated-single
 */
'use strict';

const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } = require('node:fs');
const { join, resolve, relative, dirname } = require('node:path');

const NORMALIZER_VERSION = 1;
const REPO_ROOT = resolve(__dirname, '..');
const NORMALIZED_ROOT = join(REPO_ROOT, 'fixtures/normalized');

/**
 * Stripe object-id prefixes. Ordered longest-first so that alternation cannot
 * let `sub` shadow `sub_sched`. Extend deliberately; never add secret prefixes.
 */
const ID_PREFIXES = [
  'sub_sched', 'seti', 'btok', 'acct', 'price', 'prod', 'plan', 'card', 'src',
  'txn', 'cus', 'sub', 'evt', 'req', 'txr', 'tax', 'pm', 'si', 'in', 'ii',
  'il', 'li', 'pi', 'ch', 'py', 'ba', 'cs', 'tr', 'po', 're', 'di',
];
const ID_PATTERN = new RegExp(`\\b(${ID_PREFIXES.join('|')})_[A-Za-z0-9]{2,}\\b`, 'g');

/** §24: these must never reach the repository, in raw or normalized form. */
const CREDENTIAL_PATTERN = /\b(sk_live_|sk_test_|rk_live_|rk_test_|whsec_|pk_live_|ghp_|github_pat_)[A-Za-z0-9]/;

function fail(message) {
  console.error(`normalize-fixtures: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      return value;
    };
    switch (arg) {
      case '--pair': out.pair = next(); break;
      case '--role': out.role = next(); break;
      case '--namespace': out.namespace = next(); break;
      case '--old': out.old = next(); break;
      case '--new': out.new = next(); break;
      case '--capture-method': out.captureMethod = next(); break;
      case '--envelope': out.envelope = next(); break;
      case '--out': out.out = next(); break;
      case '--verify': out.verify = true; break;
      case '--help': case '-h': out.help = true; break;
      default: throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return out;
}

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
const stableWrite = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');

/* ------------------------------------------------------------------ *
 * Alias construction
 * ------------------------------------------------------------------ */

/**
 * Walk the parsed payloads in a deterministic order and register every Stripe
 * identifier in order of first appearance. Object keys are visited in their
 * own insertion order; arrays in index order. The resulting map is therefore
 * reproducible from the raw bytes alone.
 */
function collectIdentifiers(values, namespace) {
  const aliases = new Map();
  const counters = new Map();
  const register = text => {
    for (const match of text.matchAll(ID_PATTERN)) {
      const full = match[0];
      const prefix = match[1];
      if (aliases.has(full)) continue;
      const n = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, n);
      aliases.set(full, `${prefix}_${namespace}${n}`);
    }
  };
  const walk = node => {
    if (typeof node === 'string') register(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') for (const key of Object.keys(node)) { register(key); walk(node[key]); }
  };
  values.forEach(walk);
  return aliases;
}

function applyAliases(text, aliases) {
  return text.replace(ID_PATTERN, match => aliases.get(match) ?? match);
}

/** Alias string values and string keys only. Structure is reproduced exactly. */
function aliasValue(node, aliases) {
  if (typeof node === 'string') return applyAliases(node, aliases);
  if (Array.isArray(node)) return node.map(item => aliasValue(item, aliases));
  if (node && typeof node === 'object') {
    const out = {};
    // Object.keys preserves insertion order, so key order is carried through.
    for (const key of Object.keys(node)) out[applyAliases(key, aliases)] = aliasValue(node[key], aliases);
    return out;
  }
  return node;
}

/* ------------------------------------------------------------------ *
 * The no-reshape guard
 * ------------------------------------------------------------------ */

/**
 * Assert that `normalized` differs from `raw` ONLY by alias substitution.
 * Any added key, removed key, reordered key, changed number, changed array
 * length, or unexplained string difference throws.
 */
function assertOnlyAliased(raw, normalized, aliases, path = '') {
  const at = path || '(root)';
  const rawType = Array.isArray(raw) ? 'array' : raw === null ? 'null' : typeof raw;
  const normType = Array.isArray(normalized) ? 'array' : normalized === null ? 'null' : typeof normalized;
  if (rawType !== normType) throw new Error(`type changed at ${at}: ${rawType} -> ${normType}`);

  if (rawType === 'array') {
    if (raw.length !== normalized.length) throw new Error(`array length changed at ${at}: ${raw.length} -> ${normalized.length}`);
    for (let i = 0; i < raw.length; i++) assertOnlyAliased(raw[i], normalized[i], aliases, `${at}[${i}]`);
    return;
  }
  if (rawType === 'object') {
    const rawKeys = Object.keys(raw);
    const normKeys = Object.keys(normalized);
    if (rawKeys.length !== normKeys.length) throw new Error(`key count changed at ${at}: ${rawKeys.length} -> ${normKeys.length}`);
    for (let i = 0; i < rawKeys.length; i++) {
      const expected = applyAliases(rawKeys[i], aliases);
      if (normKeys[i] !== expected) throw new Error(`key changed or reordered at ${at}: position ${i} expected ${JSON.stringify(expected)}, got ${JSON.stringify(normKeys[i])}`);
      assertOnlyAliased(raw[rawKeys[i]], normalized[normKeys[i]], aliases, `${at}.${rawKeys[i]}`);
    }
    return;
  }
  if (rawType === 'string') {
    const expected = applyAliases(raw, aliases);
    if (normalized !== expected) throw new Error(`string changed at ${at} beyond alias substitution: ${JSON.stringify(raw)} -> ${JSON.stringify(normalized)}`);
    return;
  }
  // number | boolean | null: must be byte-identical. Timestamps are preserved,
  // which is what keeps the held-out pair genuinely different (§11).
  if (!Object.is(raw, normalized)) throw new Error(`scalar changed at ${at}: ${JSON.stringify(raw)} -> ${JSON.stringify(normalized)}`);
}

/* ------------------------------------------------------------------ *
 * Read-only observation, recorded but never enforced
 * ------------------------------------------------------------------ */

function observe(event) {
  const object = event && event.data && event.data.object;
  const items = object && object.items && Array.isArray(object.items.data) ? object.items.data : null;
  return {
    apiVersion: event && typeof event.api_version === 'string' ? event.api_version : null,
    eventType: event && typeof event.type === 'string' ? event.type : null,
    objectType: object && typeof object.object === 'string' ? object.object : null,
    subscriptionLevelPeriodEnd: object && Object.hasOwn(object, 'current_period_end') ? object.current_period_end : null,
    subscriptionLevelPeriodEndPresent: Boolean(object && Object.hasOwn(object, 'current_period_end')),
    itemCount: items ? items.length : null,
    itemLevelPeriodEnds: items ? items.map(item => (item && Object.hasOwn(item, 'current_period_end') ? item.current_period_end : null)) : null,
  };
}

/* ------------------------------------------------------------------ *
 * Normalize
 * ------------------------------------------------------------------ */

function loadRaw(path, label) {
  const absolute = resolve(process.cwd(), path);
  if (!existsSync(absolute)) fail(`${label} raw file not found: ${absolute}`);
  const bytes = readFileSync(absolute);
  const text = bytes.toString('utf8');
  if (CREDENTIAL_PATTERN.test(text)) fail(`${label} raw file appears to contain a credential; refusing to process ${absolute}`);
  let parsed;
  try { parsed = JSON.parse(text); }
  catch (error) { fail(`${label} raw file is not valid JSON (${absolute}): ${error.message}`); }
  return { absolute, bytes, parsed, sha: sha256(bytes) };
}

function existingNamespaces(root, exceptPair) {
  const used = new Map();
  if (!existsSync(root)) return used;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === exceptPair) continue;
    const metaPath = join(root, entry.name, 'meta.json');
    if (!existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      if (meta && typeof meta.aliasNamespace === 'string') used.set(meta.aliasNamespace, entry.name);
    } catch { /* an unreadable sibling must not block a new pair */ }
  }
  return used;
}

function normalize(options) {
  for (const required of ['pair', 'namespace', 'old', 'new']) {
    if (!options[required]) fail(`--${required} is required`);
  }
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(options.pair)) fail('--pair must be a lowercase kebab-case identifier');
  if (!/^[A-Z][A-Z0-9]{0,7}$/.test(options.namespace)) fail('--namespace must be a short uppercase token, e.g. A or B');

  const role = options.role ?? 'planning';
  if (!['planning', 'held_out', 'auxiliary'].includes(role)) fail('--role must be planning, held_out or auxiliary');
  const envelope = options.envelope ?? 'provider';
  if (!['provider', 'synthetic'].includes(envelope)) fail('--envelope must be provider or synthetic');
  const captureMethod = options.captureMethod ?? null;
  if (captureMethod !== null && !['A', 'B', 'C'].includes(captureMethod)) fail('--capture-method must be A, B or C');
  if (envelope === 'synthetic' && captureMethod !== 'C') fail('a synthetic envelope is only produced by capture method C');
  if (captureMethod === 'C' && envelope !== 'synthetic') fail('capture method C wraps real objects in a synthetic envelope; pass --envelope synthetic');

  const outRoot = options.out ? resolve(process.cwd(), options.out) : NORMALIZED_ROOT;

  // §15: held-out separation is destroyed if two pairs share an alias namespace.
  const taken = existingNamespaces(outRoot, options.pair);
  if (taken.has(options.namespace)) fail(`alias namespace ${options.namespace} is already used by pair ${taken.get(options.namespace)}; pairs must not share a namespace`);

  const oldRaw = loadRaw(options.old, 'old');
  const newRaw = loadRaw(options.new, 'new');

  const aliases = collectIdentifiers([oldRaw.parsed, newRaw.parsed], options.namespace);
  const oldNormalized = aliasValue(oldRaw.parsed, aliases);
  const newNormalized = aliasValue(newRaw.parsed, aliases);

  try {
    assertOnlyAliased(oldRaw.parsed, oldNormalized, aliases);
    assertOnlyAliased(newRaw.parsed, newNormalized, aliases);
  } catch (error) {
    fail(`normalization would reshape the provider payload, which is forbidden: ${error.message}`);
  }

  const oldObserved = observe(oldNormalized);
  const newObserved = observe(newNormalized);
  if (oldObserved.apiVersion && newObserved.apiVersion && oldObserved.apiVersion === newObserved.apiVersion) {
    fail(`both payloads report api_version ${oldObserved.apiVersion}; the pair must span two provider contracts`);
  }

  const directory = join(outRoot, options.pair);
  mkdirSync(directory, { recursive: true });

  const meta = {
    schemaVersion: 1,
    pair: options.pair,
    role,
    envelope,
    captureMethod,
    aliasNamespace: options.namespace,
    normalizer: { tool: 'tools/normalize-fixtures.js', version: NORMALIZER_VERSION, normalizedAt: new Date().toISOString() },
    operations: [
      'record api/version metadata',
      'replace provider identifiers with pair-scoped deterministic aliases',
      'emit normalized JSON preserving key order, array order and all scalars',
      'record sha256 of each raw input',
    ],
    old: {
      apiVersion: oldObserved.apiVersion,
      eventType: oldObserved.eventType,
      objectType: oldObserved.objectType,
      rawPath: relative(REPO_ROOT, oldRaw.absolute),
      rawSha256: oldRaw.sha,
      rawBytes: oldRaw.bytes.length,
    },
    new: {
      apiVersion: newObserved.apiVersion,
      eventType: newObserved.eventType,
      objectType: newObserved.objectType,
      rawPath: relative(REPO_ROOT, newRaw.absolute),
      rawSha256: newRaw.sha,
      rawBytes: newRaw.bytes.length,
    },
    // Recorded observation only. Nothing downstream is allowed to depend on
    // this being any particular shape; the differ decides, not the normalizer.
    observed: {
      old: { subscriptionLevelPeriodEndPresent: oldObserved.subscriptionLevelPeriodEndPresent, subscriptionLevelPeriodEnd: oldObserved.subscriptionLevelPeriodEnd, itemCount: oldObserved.itemCount, itemLevelPeriodEnds: oldObserved.itemLevelPeriodEnds },
      new: { subscriptionLevelPeriodEndPresent: newObserved.subscriptionLevelPeriodEndPresent, subscriptionLevelPeriodEnd: newObserved.subscriptionLevelPeriodEnd, itemCount: newObserved.itemCount, itemLevelPeriodEnds: newObserved.itemLevelPeriodEnds },
    },
    aliases: Object.fromEntries([...aliases.entries()].map(([from, to]) => [from, to])),
  };
  if (envelope === 'synthetic') {
    meta.syntheticEnvelopeDisclosure = 'Objects are real Stripe responses retrieved under two Stripe-Version headers. The event envelope around them was constructed locally and was NOT delivered by Stripe.';
  }

  stableWrite(join(directory, 'old.json'), oldNormalized);
  stableWrite(join(directory, 'new.json'), newNormalized);
  stableWrite(join(directory, 'meta.json'), meta);

  console.log(`normalized pair ${options.pair} (role=${role}, namespace=${options.namespace}, envelope=${envelope})`);
  console.log(`  old  ${meta.old.apiVersion}  sha256=${oldRaw.sha.slice(0, 12)}…  ${meta.old.rawPath}`);
  console.log(`  new  ${meta.new.apiVersion}  sha256=${newRaw.sha.slice(0, 12)}…  ${meta.new.rawPath}`);
  console.log(`  aliases: ${aliases.size}`);
  console.log('  observed (recorded, not enforced):');
  console.log(`    old: sub.current_period_end=${oldObserved.subscriptionLevelPeriodEndPresent ? oldObserved.subscriptionLevelPeriodEnd : 'ABSENT'} items=${oldObserved.itemCount} item ends=${JSON.stringify(oldObserved.itemLevelPeriodEnds)}`);
  console.log(`    new: sub.current_period_end=${newObserved.subscriptionLevelPeriodEndPresent ? newObserved.subscriptionLevelPeriodEnd : 'ABSENT'} items=${newObserved.itemCount} item ends=${JSON.stringify(newObserved.itemLevelPeriodEnds)}`);
  console.log(`  -> ${directory}`);
  return { directory, meta };
}

/* ------------------------------------------------------------------ *
 * Verify
 * ------------------------------------------------------------------ */

function verifyPair(root, pair) {
  const directory = join(root, pair);
  const problems = [];
  const metaPath = join(directory, 'meta.json');
  if (!existsSync(metaPath)) return [`${pair}: meta.json missing`];
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const aliases = new Map(Object.entries(meta.aliases ?? {}));

  for (const side of ['old', 'new']) {
    const record = meta[side];
    if (!record) { problems.push(`${pair}/${side}: metadata missing`); continue; }
    const rawPath = join(REPO_ROOT, record.rawPath);
    if (!existsSync(rawPath)) { problems.push(`${pair}/${side}: raw input missing at ${record.rawPath}`); continue; }
    const bytes = readFileSync(rawPath);
    const actual = sha256(bytes);
    if (actual !== record.rawSha256) {
      problems.push(`${pair}/${side}: raw sha256 mismatch — evidence changed since normalization (meta ${record.rawSha256.slice(0, 12)}… actual ${actual.slice(0, 12)}…)`);
      continue;
    }
    const raw = JSON.parse(bytes.toString('utf8'));
    const onDisk = JSON.parse(readFileSync(join(directory, `${side}.json`), 'utf8'));
    try { assertOnlyAliased(raw, onDisk, aliases); }
    catch (error) { problems.push(`${pair}/${side}: normalized output is not an alias-only transform of its raw input — ${error.message}`); }
  }
  return problems;
}

function verify(options) {
  const root = options.out ? resolve(process.cwd(), options.out) : NORMALIZED_ROOT;
  if (!existsSync(root)) fail(`no normalized fixtures at ${root}`);
  const pairs = options.pair
    ? [options.pair]
    : readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
  if (!pairs.length) { console.log('normalize-fixtures --verify: no normalized pairs present'); return; }

  const namespaces = new Map();
  let failed = false;
  for (const pair of pairs) {
    const problems = verifyPair(root, pair);
    const metaPath = join(root, pair, 'meta.json');
    if (existsSync(metaPath)) {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      if (typeof meta.aliasNamespace === 'string') {
        if (namespaces.has(meta.aliasNamespace)) problems.push(`${pair}: alias namespace ${meta.aliasNamespace} collides with ${namespaces.get(meta.aliasNamespace)}`);
        else namespaces.set(meta.aliasNamespace, pair);
      }
    }
    if (problems.length) { failed = true; for (const problem of problems) console.error(`  FAIL ${problem}`); }
    else console.log(`  OK   ${pair}`);
  }
  if (failed) { console.error('normalize-fixtures --verify: provenance validation FAILED'); process.exit(1); }
  console.log(`normalize-fixtures --verify: ${pairs.length} pair(s) validated`);
}

/* ------------------------------------------------------------------ */

function main() {
  let options;
  try { options = parseArgs(process.argv.slice(2)); }
  catch (error) { fail(error.message); }
  if (options.help || process.argv.length === 2) {
    console.log(readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*\*?/, '').replace(/^ ?\* ?/gm, ''));
    process.exit(0);
  }
  if (options.verify) verify(options);
  else normalize(options);
}

if (require.main === module) main();

module.exports = { collectIdentifiers, applyAliases, aliasValue, assertOnlyAliased, observe, sha256, ID_PATTERN, ID_PREFIXES, CREDENTIAL_PATTERN };
