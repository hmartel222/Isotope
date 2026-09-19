import { Command, InvalidArgumentError } from 'commander';
import { NotImplementedStageError } from '@isotope/core';
import { verifyWalkingSkeleton } from './walking-skeleton';
import { scanProject } from './scan';
import { verifyRepository } from './verify-repository';
import { resolve } from 'node:path';
import { realpath } from 'node:fs/promises';
import { runDetectionMatrix } from './matrix';
import { repairExistingFailure } from './repair-flow';
export { verifyWalkingSkeleton } from './walking-skeleton';
export { scanProject } from './scan';
export { runDetectionMatrix } from './matrix';
export { verifyRepository } from './verify-repository';

function pending(stage: string): never { throw new NotImplementedStageError(stage); }
export function createProgram(): Command {
  const program = new Command().exitOverride().name('isotope').description('Isotope — provider dataflow and behavioral verification').version('0.1.0');
  program.option('--config <path>', 'configuration file', 'isotope.yml');
  program.command('scan').description('L2: analyze configured entry points and write the BDG').action(async () => console.log(await scanProject(program.opts<{ config: string }>().config)));
  program.command('verify').description('Analyze and verify configured entry points').option('--no-reasoner', 'mechanical verification only').option('--no-repair', 'stop after detection and verdict').option('--base <ref>', 'local Git base revision').option('--head <ref>', 'local Git head revision').action(async (options: { reasoner: boolean; repair: boolean; base?: string; head?: string }) => {
    const testFixtureDirectory = process.env.ISOTOPE_TEST_FIXTURES;
    if ((options.base && !options.head) || (!options.base && options.head)) throw new InvalidArgumentError('--base and --head must be supplied together');
    const configPath = program.opts<{ config: string }>().config;
    if (options.base && options.head) {
      const configAbsolute = await realpath(resolve(configPath)); const root = resolve(configAbsolute, '..');
      const result = await verifyRepository({ repositoryRoot: root, configPath: configAbsolute, specsPath: resolve(__dirname, '../../../specs'),
        baseRef: options.base, headRef: options.head, reasoner: 'off', repair: options.repair === false ? 'off' : 'on', ...(testFixtureDirectory ? { testFixtureDirectory } : {}) });
      console.log(result.output); process.exitCode = result.exitCode; return;
    }
    const result = await verifyWalkingSkeleton({ configPath, disableReasoner: options.reasoner === false, disableRepair: options.repair === false, ...(testFixtureDirectory ? { testFixtureDirectory } : {}) });
    console.log(result.output);
    process.exitCode = result.exitCode;
  });
  program.command('repair [entry-point]').description('Verify a deterministic repair for an existing mechanical FAIL').option('--explain <repairId>', 'explain an existing repair').action(async (entry: string | undefined, options: { explain?: string }) => {
    if ((!entry && !options.explain) || (entry && options.explain)) throw new InvalidArgumentError('provide either an entry-point or --explain <repairId>');
    if (options.explain) pending('repair --explain');
    const result = await repairExistingFailure({ configPath: program.opts<{ config: string }>().config, entryPoint: entry!, ...(process.env.ISOTOPE_TEST_FIXTURES ? { testFixtureDirectory: process.env.ISOTOPE_TEST_FIXTURES } : {}) });
    console.log(result.output); process.exitCode = result.exitCode;
  });
  program.command('explain <entry-point>').description('Inspect signatures, diff, and reasoning (stub)').action(() => pending('explain'));
  program.command('fleet').description('Run batch analysis and produce a static dashboard (stub)').option('--repos <path>', 'repository manifest').option('--spec <id>', 'ChangeSpec identifier').option('--out <path>', 'dashboard file').option('--reason', 'enable reasoning').option('--repair', 'enable repair').action(() => pending('fleet'));
  const spec = program.command('spec').description('ChangeSpec management (stubs)');
  spec.command('validate [path]').description('Validate ChangeSpecs').action(() => pending('spec validate'));
  spec.command('draft').description('Draft a ChangeSpec').requiredOption('--url <url>', 'changelog URL').requiredOption('--provider <provider>', 'provider name').action(() => pending('spec draft'));
  spec.command('list').description('List ChangeSpecs').action(() => pending('spec list'));
  program.command('fixtures').description('Provider fixture management (stub)').command('normalize').option('--raw <path>', 'raw fixture directory').option('--out <path>', 'normalized fixture directory').action(() => pending('fixtures normalize'));
  program.command('matrix').description('Run the deterministic detection acceptance matrix')
    .option('--group <group>', 'matrix group', 'detection').option('--case <id>', 'run one case')
    .option('--keep-artifacts', 'retain temporary case repositories').option('--allow-blocked', 'do not fail for unavailable cases')
    .action(async (options: { group: string; case?: string; keepArtifacts?: boolean; allowBlocked?: boolean }) => {
      if (options.group !== 'detection') throw new InvalidArgumentError('only --group detection is implemented');
      const result = await runDetectionMatrix({ ...(options.case ? { caseId: options.case } : {}), keepArtifacts: options.keepArtifacts === true, allowBlocked: options.allowBlocked === true });
      console.log(result.output); process.exitCode = result.exitCode;
    });
  program.command('accuracy').description('Run the historical benchmark (stub)').action(() => pending('accuracy'));
  program.addHelpText('after', '\nCommand forms:\n  verify --no-reasoner\n  verify --no-repair\n  repair <entry-point>\n  repair --explain <repairId>\n  spec validate|draft|list\n  fixtures normalize\n\nscan performs static analysis only. verify uses the generated BDG and isolated harness. Deterministic repairs are isolated and independently verified; semantic reasoning and model repair remain unavailable.');
  return program;
}
