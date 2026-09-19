import { startVitest } from 'vitest/node';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
process.env.ISOTOPE_RUN_PLAN = process.argv[2];
let context;
try {
  context = await startVitest('test', [], {
    config: false, root: dirname(fileURLToPath(import.meta.url)), include: ['specimen.test.mjs'],
    watch: false, reporters: ['dot'], pool: 'forks', maxWorkers: 1, minWorkers: 1,
    fileParallelism: false, isolate: true, testTimeout: 8_000, cache: false,
  }, { resolve: { alias: { stripe: require.resolve('stripe') } }, server: { watch: null } });
  if (!context || context.state.getUnhandledErrors().length) process.exitCode = 1;
} finally { await context?.close(); }
