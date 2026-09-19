import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const bin = resolve(root, 'node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/bin/esbuild');
const out = resolve(root, 'action/dist');
async function run(args) {
  await new Promise((done, reject) => {
    const child = spawn(bin, args, { cwd: root, stdio: 'inherit' });
    child.once('error', reject); child.once('close', code => code === 0 ? done() : reject(new Error(`esbuild exited ${code}`)));
  });
}
async function command(command, args, cwd = root) {
  await new Promise((done, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.once('error', reject); child.once('close', code => code === 0 ? done() : reject(new Error(`${command} exited ${code}`)));
  });
}
await rm(out, { recursive: true, force: true }); await mkdir(out, { recursive: true });
await run(['action/src/index.ts', '--bundle', '--platform=node', '--target=node20', '--format=cjs', '--outfile=action/dist/index.js', '--log-level=warning']);
await run(['action/src/context.ts', '--bundle', '--platform=node', '--target=node20', '--format=cjs', '--outfile=action/dist/context.cjs', '--log-level=warning']);

// Keep the committed child runtime synchronized and portable across the macOS
// development host and GitHub's Linux runner.
const archive = resolve(root, 'action/vendor/vitest-runtime.tgz');
const staging = await mkdtemp(resolve(tmpdir(), 'isotope-action-runtime-build-'));
try {
  await command('tar', ['-xzf', archive, '-C', staging]);
  await cp(resolve(root, 'packages/harness-ts/dist'), resolve(staging, 'dist'), { recursive: true, force: true });
  await cp(resolve(root, 'packages/harness-ts/runtime'), resolve(staging, 'runtime'), { recursive: true, force: true });
  await cp(resolve(root, 'packages/harness-ts/block-net.cjs'), resolve(staging, 'block-net.cjs'), { force: true });
  for (const platform of ['darwin-arm64', 'linux-x64']) {
    const source = resolve(root, `node_modules/.pnpm/@esbuild+${platform}@0.28.2/node_modules/@esbuild/${platform}`);
    await cp(source, resolve(staging, `node_modules/@esbuild/${platform}`), { recursive: true, force: true });
  }
  await command('tar', ['-czf', archive, '.'], staging);
} finally {
  await rm(staging, { recursive: true, force: true });
}
