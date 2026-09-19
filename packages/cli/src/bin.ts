#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CommanderError } from 'commander';
import { NotImplementedStageError } from '@isotope/core';
import { createProgram } from './index';

function loadLocalEnv(): void {
  for (const file of [resolve(process.cwd(), '.env'), resolve(__dirname, '../../../.env')]) {
    try {
      for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
        const text = line.trim();
        if (!text || text.startsWith('#')) continue;
        const idx = text.indexOf('=');
        if (idx < 1) continue;
        const name = text.slice(0, idx).trim();
        const value = text.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
        if (name && process.env[name] === undefined) process.env[name] = value;
      }
    } catch { /* optional local secrets file */ }
  }
}

async function main(): Promise<void> {
  loadLocalEnv();
  try { await createProgram().exitOverride().parseAsync(process.argv); }
  catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) return;
    if (error instanceof NotImplementedStageError) {
      console.error(error.message);
      process.exitCode = 12; // Scaffold-only status, never a v3 product verdict.
    } else {
      if (!(error instanceof CommanderError)) console.error((error as Error).message);
      process.exitCode = 10;
    }
  }
}
void main();
