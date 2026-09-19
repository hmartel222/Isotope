import { mkdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const bin = resolve(root, 'node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/bin/esbuild');
const out = resolve(root, 'action/dist');
async function run(args) {
  await new Promise((done, reject) => {
    const child = spawn(bin, args, { cwd: root, stdio: 'inherit' });
    child.once('error', reject); child.once('close', code => code === 0 ? done() : reject(new Error(`esbuild exited ${code}`)));
  });
}
await rm(out, { recursive: true, force: true }); await mkdir(out, { recursive: true });
await run(['action/src/index.ts', '--bundle', '--platform=node', '--target=node20', '--format=cjs', '--outfile=action/dist/index.js', '--log-level=warning']);
await run(['action/src/context.ts', '--bundle', '--platform=node', '--target=node20', '--format=cjs', '--outfile=action/dist/context.cjs', '--log-level=warning']);
