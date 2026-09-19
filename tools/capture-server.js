#!/usr/bin/env node
/**
 * Isotope raw provider capture server (v3 §1.2, §7).
 *
 * Sole responsibility: receive a webhook request, write the raw request body
 * VERBATIM, and write provenance metadata beside it.
 *
 * This process NEVER normalizes, reformats, reorders, prettifies, aliases or
 * otherwise touches the provider bytes. `fixtures/raw/**` is evidence.
 *
 * Usage:
 *   node tools/capture-server.js --port 4242 --out fixtures/raw
 *
 * Then point one Stripe destination per API version at a distinct path, where
 * the path segment becomes the raw sub-directory label:
 *
 *   https://<tunnel>/acacia   -> fixtures/raw/acacia/<event>.<ts>.json
 *   https://<tunnel>/dahlia   -> fixtures/raw/dahlia/<event>.<ts>.json
 */
'use strict';

const http = require('node:http');
const { createHash } = require('node:crypto');
const { mkdirSync, writeFileSync, existsSync } = require('node:fs');
const { join, resolve } = require('node:path');

const LABEL = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

function parseArgs(argv) {
  const out = { port: 4242, out: 'fixtures/raw' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      return value;
    };
    if (arg === '--port') out.port = Number(next());
    else if (arg === '--out') out.out = next();
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(out.port) || out.port < 1 || out.port > 65535) throw new Error('--port must be a valid TCP port');
  return out;
}

/** Read-only inspection. Never mutates and never affects what is written. */
function inspect(raw) {
  try {
    const event = JSON.parse(raw.toString('utf8'));
    const object = event && event.data && event.data.object;
    const items = object && object.items && Array.isArray(object.items.data) ? object.items.data : null;
    return {
      ok: true,
      eventId: typeof event.id === 'string' ? event.id : null,
      eventType: typeof event.type === 'string' ? event.type : null,
      payloadApiVersion: typeof event.api_version === 'string' ? event.api_version : null,
      objectType: object && typeof object.object === 'string' ? object.object : null,
      objectId: object && typeof object.id === 'string' ? object.id : null,
      // The two facts §10 tells us to verify rather than assume.
      subscriptionLevelPeriodEnd: object && Object.hasOwn(object, 'current_period_end') ? object.current_period_end : undefined,
      itemCount: items ? items.length : null,
      itemLevelPeriodEnds: items ? items.map(item => (item && Object.hasOwn(item, 'current_period_end') ? item.current_period_end : undefined)) : null,
    };
  } catch (error) {
    return { ok: false, parseError: String(error && error.message ? error.message : error) };
  }
}

function safeFilenamePart(value, fallback) {
  const text = typeof value === 'string' && value ? value : fallback;
  return text.replace(/[^A-Za-z0-9._-]/g, '_');
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`capture-server: ${error.message}`);
    process.exit(2);
  }
  if (options.help) {
    console.log('Usage: node tools/capture-server.js [--port 4242] [--out fixtures/raw]');
    process.exit(0);
  }

  const outRoot = resolve(process.cwd(), options.out);
  mkdirSync(outRoot, { recursive: true });
  let captured = 0;

  const server = http.createServer((req, res) => {
    const label = decodeURIComponent((req.url || '/').split('?')[0].replace(/^\/+/, '').replace(/\/+$/, ''));

    if (req.method === 'GET' && (label === '' || label === 'health')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, captured, out: outRoot }));
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'POST only' }));
      return;
    }
    if (!LABEL.test(label)) {
      console.error(`capture-server: rejected request with unusable version label ${JSON.stringify(label)}`);
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Path must be a single version label, e.g. /acacia or /dahlia' }));
      return;
    }

    const chunks = [];
    let size = 0;
    let aborted = false;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        res.writeHead(413, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Body too large' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', () => { aborted = true; });
    req.on('end', () => {
      if (aborted) return;
      // The exact bytes Stripe sent. Never re-serialized.
      const raw = Buffer.concat(chunks);
      const receivedAt = new Date().toISOString();
      const sha256 = createHash('sha256').update(raw).digest('hex');
      const facts = inspect(raw);

      const directory = join(outRoot, label);
      mkdirSync(directory, { recursive: true });
      const stem = `${safeFilenamePart(facts.eventType, 'unknown-event')}.${receivedAt.replace(/[:.]/g, '-')}.${sha256.slice(0, 8)}`;
      const bodyPath = join(directory, `${stem}.json`);
      const metaPath = join(directory, `${stem}.meta.json`);

      if (existsSync(bodyPath)) {
        // Raw evidence is append-only. Never clobber a prior capture.
        console.error(`capture-server: refusing to overwrite existing raw capture ${bodyPath}`);
        res.writeHead(409, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Raw capture already exists' }));
        return;
      }

      const meta = {
        captureTool: 'tools/capture-server.js',
        captureToolVersion: 1,
        versionLabel: label,
        requestPath: req.url,
        receivedAt,
        rawFile: `${stem}.json`,
        rawSha256: sha256,
        rawBytes: raw.length,
        // v3 §7: preserve the delivery signature header as provenance.
        stripeSignature: req.headers['stripe-signature'] || null,
        userAgent: req.headers['user-agent'] || null,
        contentType: req.headers['content-type'] || null,
        payloadApiVersion: facts.payloadApiVersion ?? null,
        eventId: facts.eventId ?? null,
        eventType: facts.eventType ?? null,
        objectType: facts.objectType ?? null,
        objectId: facts.objectId ?? null,
        envelope: 'provider',
        parseOk: facts.ok === true,
        parseError: facts.ok ? null : facts.parseError,
      };
      writeFileSync(bodyPath, raw);
      writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
      captured++;

      // Operator-facing summary so §10 verification does not require opening files.
      const periodSummary = facts.ok
        ? `sub.current_period_end=${facts.subscriptionLevelPeriodEnd === undefined ? 'ABSENT' : facts.subscriptionLevelPeriodEnd}` +
          ` items=${facts.itemCount} item.current_period_end=[${(facts.itemLevelPeriodEnds || []).map(v => (v === undefined ? 'ABSENT' : v)).join(', ')}]`
        : `UNPARSEABLE (${facts.parseError})`;
      console.log(
        `[${receivedAt}] ${label} ${facts.eventType || '?'} api_version=${facts.payloadApiVersion || '?'} ` +
        `${facts.objectId || '?'} sha256=${sha256.slice(0, 12)}…\n    ${periodSummary}\n    -> ${bodyPath}`
      );

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ received: true }));
    });
  });

  server.listen(options.port, '127.0.0.1', () => {
    console.log(`capture-server listening on http://127.0.0.1:${options.port}`);
    console.log(`raw output root: ${outRoot}`);
    console.log('POST to /<version-label>, e.g. /acacia and /dahlia. GET / for health.');
  });
  const shutdown = () => { console.log(`\ncapture-server: ${captured} raw capture(s) written.`); server.close(() => process.exit(0)); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
