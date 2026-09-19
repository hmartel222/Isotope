import { startVitest } from 'vitest/node';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
(async () => {
process.env.ISOTOPE_RUN_PLAN = process.argv[2];
const plan = JSON.parse(readFileSync(process.argv[2], 'utf8'));
// Bare configured packages need no actual SDK installation. Never load their real module.
const aliases = {};
for (const [index, mock] of plan.mocks.entries()) {
  if (mock.module.startsWith('/')) continue;
  const stub = join(dirname(process.argv[2]), `virtual-${index}.mjs`);
  writeFileSync(stub, 'export default {};');
  aliases[mock.module] = stub;
  mock.module = stub;
}
writeFileSync(process.argv[2], JSON.stringify(plan));
let context;
try {
  context = await startVitest('test', [], {
    config: false, root: plan.repositoryRoot, include: [plan.specPath], exclude: [],
    watch: false, reporters: ['dot'], pool: 'forks', maxWorkers: 1, minWorkers: 1,
    fileParallelism: false, isolate: true, testTimeout: 121_000, cache: false,
  }, {
    resolve: { alias: aliases }, server: { watch: null },
  });
  if (!context || context.state.getUnhandledErrors().length || context.state.getFiles().length !== 1 || context.state.getFiles().some(file => file.result?.state !== 'pass')) process.exitCode = 1;
} catch (error) {
  writeFileSync(plan.resultPath, JSON.stringify({ error: { reason: 'harness_could_not_run', message: String(error) } }));
  process.exitCode = 1;
} finally { await context?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
