import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

function inside(root, target) {
  const rel = relative(root, target);
  return rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel);
}

const source = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Usage: validate-source-manifest.mjs <reviewed-source>');
const trustedRoot = await realpath(resolve('.isotope/sources'));
const actualSource = await realpath(source);
if (!inside(trustedRoot, actualSource)) throw new Error('Source resolves outside .isotope/sources');
const manifestPath = join(dirname(actualSource), 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (!manifest || manifest.schemaVersion !== 1 || typeof manifest.files !== 'object') throw new Error('Invalid source manifest');
for (const [file, expected] of Object.entries(manifest.files)) {
  if (!/^[a-f0-9]{64}$/.test(String(expected))) throw new Error(`Invalid SHA-256 for ${file}`);
  const actual = await realpath(join(dirname(actualSource), file));
  if (!inside(dirname(actualSource), actual)) throw new Error(`Manifest file escapes source packet: ${file}`);
  const hash = createHash('sha256').update(await readFile(actual)).digest('hex');
  if (hash !== expected) throw new Error(`Source manifest hash mismatch: ${file}`);
}
if (!(actualSource in Object.fromEntries(Object.keys(manifest.files).map(file => [resolve(dirname(actualSource), file), true])))) {
  throw new Error('Selected source is not listed in its manifest');
}
console.log(`Validated reviewed source manifest: ${manifestPath}`);
