import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep, extname } from 'node:path';
import type { EntryPoint, HarnessInput, IsotopeConfig, Signature } from '@isotope/core';
import { HarnessExecutionError } from './errors';
export interface TsHarnessPlan {
  repositoryRoot: string;
  entryPoint: { id: string; file: string; exportName: string; kind: EntryPoint['kind'] };
  fixture: { pairId: string; side: 'old' | 'new'; payloadVersion: string; payloadPath: string };
  codeVersion: Signature['codeVersion'];
  mocks: IsotopeConfig['mocks'];
  mockReturns: IsotopeConfig['returns'];
  provider: { requireWebhookInterception: boolean };
  runIndex: number;
  /** Optional authoritative artifact destination, relative to repositoryRoot. */
  outputPath?: string;
}
export function createTsHarnessPlan(input: Omit<HarnessInput, 'bdg'>, side: 'old' | 'new', runIndex: number): TsHarnessPlan {
  return {
    repositoryRoot: input.repoRoot,
    entryPoint: { id: input.entryPoint.id, file: input.entryPoint.file, exportName: input.entryPoint.export, kind: input.entryPoint.kind },
    fixture: { pairId: input.fixture.id, side, payloadVersion: side === 'old' ? input.fixture.oldVersion : input.fixture.newVersion,
      payloadPath: side === 'old' ? input.fixture.oldPath : input.fixture.newPath },
    codeVersion: input.codeVersion, mocks: input.config.mocks, mockReturns: input.config.returns, runIndex,
    provider: { requireWebhookInterception: input.entryPoint.kind !== 'plain' && input.config.mocks.some(m => 'strategy' in m && m.module === 'stripe') },
  };
}
export function assertWithin(root: string, target: string): string {
  const rel = relative(root, target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new HarnessExecutionError('unsupported_harness_plan', `Path must remain inside repository: ${target}`);
  return target;
}
export async function projectFile(root: string, file: string): Promise<string> {
  const target = assertWithin(root, resolve(root, file));
  for (const suffix of extname(target) ? [''] : ['', '.ts', '.tsx', '.js', '.mjs', '.cjs', '/index.ts', '/index.js']) {
    try {
      const actual = assertWithin(root, await realpath(target + suffix));
      if ((await lstat(actual)).isFile()) return actual;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  throw new HarnessExecutionError('mock_resolution_failed', `Local file did not resolve: ${file}`);
}
/** Local paths are config-root relative, preserving Phase 2's src/db.ts convention. */
export function isLocalModule(module: string): boolean {
  return isAbsolute(module) || module.startsWith('.') || module.startsWith('src/') || /\.[cm]?[jt]sx?$/.test(module);
}
