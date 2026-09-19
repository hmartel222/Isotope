#!/usr/bin/env node
import { CommanderError } from 'commander';
import { NotImplementedStageError } from '@isotope/core';
import { createProgram } from './index';

async function main(): Promise<void> {
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
