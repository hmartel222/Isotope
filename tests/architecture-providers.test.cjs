const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const genericNoProvidersPackage = ['core', 'differ', 'repair', 'verifier', 'reporter', 'fleet'];
const implementationImport = /providers\/src\/providers\/|@isotope\/providers\/src\/providers/;

async function tsFiles(dir) {
  const out = [];
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return out; throw error; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await tsFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

test('generic packages do not import provider implementations or @isotope/providers', async () => {
  const hits = [];
  for (const name of genericNoProvidersPackage) {
    for (const file of await tsFiles(path.join(root, 'packages', name, 'src'))) {
      const text = await fs.readFile(file, 'utf8');
      if (text.includes('@isotope/providers') || implementationImport.test(text)) hits.push(path.relative(root, file));
    }
  }
  assert.deepEqual(hits, []);
});

test('pipeline packages do not import a concrete providers/<id> module', async () => {
  const hits = [];
  for (const name of ['changespec', 'cli', 'harness-ts', 'harness-py', 'reasoner', 'resolver-ts', 'resolver-py']) {
    for (const file of await tsFiles(path.join(root, 'packages', name, 'src'))) {
      const text = await fs.readFile(file, 'utf8');
      if (implementationImport.test(text)) hits.push(path.relative(root, file));
    }
  }
  assert.deepEqual(hits, []);
});

test('generic packages do not branch on a privileged provider id', async () => {
  const hits = [];
  for (const name of [...genericNoProvidersPackage, 'changespec', 'cli', 'harness-ts', 'reasoner', 'resolver-ts', 'differ']) {
    for (const file of await tsFiles(path.join(root, 'packages', name, 'src'))) {
      const text = await fs.readFile(file, 'utf8');
      if (/\bprovider\s*===\s*['"](stripe|snowflake)['"]/.test(text) || /\bpackage\s*===\s*['"](stripe|snowflake-sdk)['"]/.test(text)) hits.push(path.relative(root, file));
    }
  }
  assert.deepEqual(hits, []);
});
