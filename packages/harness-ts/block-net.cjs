// Loaded by NODE_OPTIONS in the runner and every Vitest fork, before customer imports.
const { appendFileSync } = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const attempts = [];
function block(api) {
  return function () {
    // Deliberately omit addresses, headers, and credentials from diagnostics.
    const event = { seq: attempts.length, mock: 'blocked_egress', sinkKind: 'http_out', args: [api] };
    if (attempts.length < 100) {
      attempts.push(event);
      if (process.env.ISOTOPE_EGRESS_LOG) appendFileSync(process.env.ISOTOPE_EGRESS_LOG, JSON.stringify(event) + '\n');
    }
    const error = new Error(`Isotope blocked unexpected egress via ${api}`);
    error.name = 'IsotopeEgressBlocked';
    throw error;
  };
}
for (const name of ['http', 'https']) {
  const mod = require('node:' + name);
  mod.request = block(name + '.request'); mod.get = block(name + '.get');
}
const net = require('node:net');
net.Socket.prototype.connect = block('net.Socket.connect');
net.connect = block('net.connect'); net.createConnection = block('net.createConnection');
require('node:tls').connect = block('tls.connect');
const dgram = require('node:dgram');
dgram.Socket.prototype.connect = block('dgram.connect');
dgram.Socket.prototype.send = block('dgram.send');
globalThis.fetch = block('fetch');
syncBuiltinESMExports();
module.exports = { attempts, block };
