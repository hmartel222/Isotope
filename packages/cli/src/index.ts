import { Command, InvalidArgumentError } from 'commander';
import { NotImplementedStageError } from '@isotope/core';
import { verifyWalkingSkeleton } from './walking-skeleton';
import { scanProject } from './scan';
export { verifyWalkingSkeleton } from './walking-skeleton';
export { scanProject } from './scan';

function pending(stage: string): never { throw new NotImplementedStageError(stage); }
export function createProgram(): Command {
  const program = new Command().exitOverride().name('isotope').description('Isotope — provider dataflow and behavioral verification').version('0.1.0');
  program.option('--config <path>', 'configuration file', 'isotope.yml');
  program.command('scan').description('L2: analyze configured entry points and write the BDG').action(async () => console.log(await scanProject(program.opts<{ config: string }>().config)));
  program.command('verify').description('Analyze and verify explicitly configured entry points').option('--no-reasoner', 'mechanical verification only').option('--no-repair', 'stop after detection and verdict').action(async (options: { reasoner: boolean; repair: boolean }) => {
    const testFixtureDirectory = process.env.ISOTOPE_TEST_FIXTURES;
    const result = await verifyWalkingSkeleton({ configPath: program.opts<{ config: string }>().config, disableReasoner: options.reasoner === false, disableRepair: options.repair === false, ...(testFixtureDirectory ? { testFixtureDirectory } : {}) });
    console.log(result.output);
    process.exitCode = result.exitCode;
  });
  program.command('repair [entry-point]').description('Propose a repair or inspect an existing repair (stub)').option('--explain <repairId>', 'explain an existing repair').action((entry: string | undefined, options: { explain?: string }) => {
    if ((!entry && !options.explain) || (entry && options.explain)) throw new InvalidArgumentError('provide either an entry-point or --explain <repairId>');
    pending('repair');
  });
  program.command('explain <entry-point>').description('Inspect signatures, diff, and reasoning (stub)').action(() => pending('explain'));
  program.command('fleet').description('Run batch analysis and produce a static dashboard (stub)').option('--repos <path>', 'repository manifest').option('--spec <id>', 'ChangeSpec identifier').option('--out <path>', 'dashboard file').option('--reason', 'enable reasoning').option('--repair', 'enable repair').action(() => pending('fleet'));
  const spec = program.command('spec').description('ChangeSpec management (stubs)');
  spec.command('validate [path]').description('Validate ChangeSpecs').action(() => pending('spec validate'));
  spec.command('draft').description('Draft a ChangeSpec').requiredOption('--url <url>', 'changelog URL').requiredOption('--provider <provider>', 'provider name').action(() => pending('spec draft'));
  spec.command('list').description('List ChangeSpecs').action(() => pending('spec list'));
  program.command('fixtures').description('Provider fixture management (stub)').command('normalize').option('--raw <path>', 'raw fixture directory').option('--out <path>', 'normalized fixture directory').action(() => pending('fixtures normalize'));
  program.command('matrix').description('Run the acceptance matrix (stub)').action(() => pending('matrix'));
  program.command('accuracy').description('Run the historical benchmark (stub)').action(() => pending('accuracy'));
  program.addHelpText('after', '\nCommand forms:\n  verify --no-reasoner\n  verify --no-repair\n  repair <entry-point>\n  repair --explain <repairId>\n  spec validate|draft|list\n  fixtures normalize\n\nscan performs static analysis only. verify uses the generated BDG and isolated harness. ChangeSpec selection remains explicit; reasoner and repair remain unimplemented.');
  return program;
}
