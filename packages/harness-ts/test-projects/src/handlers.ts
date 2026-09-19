// Synthetic harness engineering specimens. Never provider/benchmark evidence.
import { writeFileSync } from 'node:fs';
import crypto, { randomUUID } from 'node:crypto';
import { randomUUID as unprefixedUUID } from 'crypto';
import http, { request } from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { db } from './db';
import { send } from '@isotope-test/mail';
import queue from '@isotope-test/queue';
let count = 0;
export function entropy(event) {
  console.log('{ this is not protocol JSON }');
  return { now: Date.now(), date: new Date(), random: Math.random(), uuid: crypto.randomUUID(),
    named: randomUUID(), unprefixed: unprefixedUUID(), web: globalThis.crypto.randomUUID(),
    hash: crypto.createHash('sha256').update('still works').digest('hex'), env: process.env.ISOTOPE_SECRET_TEST, count: ++count };
}
export async function mutation(event) {
  const args = { before: event.value, count: ++count };
  await db.user.create(args);
  args.before = 99; event.value = 77;
  return { count, value: event.value };
}
export async function effects(event) {
  const value = await db.invoice.upsert({ value: event.value, missing: undefined });
  value.id = 'mutated';
  await send({ ready: true });
  queue.publish(['b', 'a']);
  return { fresh: await db.invoice.upsert({ final: true }), absent: await db.other(), then: db.then };
}
export function special() {
  const cycle: any = { a: 1 }; cycle.self = cycle;
  db.user.create({ cycle, fn: () => 1, buffer: Buffer.from('hello'), undefined: undefined });
  return { nan: NaN, positive: Infinity, negative: -Infinity, bigint: 123n };
}
export function tooLarge() { return Array.from({ length: 501 }, (_, i) => i); }
export function throwing() { throw new TypeError('customer failure'); }
export function hanging(event) { writeFileSync(event.pidPath, String(process.pid)); while (true) {} }
export function promiseHang(event) { writeFileSync(event.pidPath, String(process.pid)); return new Promise(() => {}); }
export function killed() { process.kill(process.pid, 'SIGKILL'); }
export function crash() { process.exit(17); }
export async function asyncTimer() { await new Promise(resolve => setTimeout(resolve, 5)); return Date.now(); }
export async function egress(event) {
  const url = `http://127.0.0.1:${event.port}/secret?token=do-not-log`;
  try {
    switch (event.api) {
      case 'fetch': await fetch(url); break;
      case 'http': http.request(url).end(); break;
      case 'https': https.request(url.replace('http:', 'https:')).end(); break;
      case 'net': net.connect({ host: '127.0.0.1', port: event.port }); break;
      case 'named': request(url).end(); break;
    }
  } catch {}
  return 'caught network errors cannot hide egress';
}
