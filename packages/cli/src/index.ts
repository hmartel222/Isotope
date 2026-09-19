import { Command, InvalidArgumentError } from 'commander';
import { NotImplementedStageError } from '@isotope/core';

function pending(stage: string): never { throw new NotImplementedStageError(stage); }
export function createProgram(): Command {
  const program = new Command().exitOverride().name('isotope').description('Isotope — Phase 1 contracts/scaffold only').version('0.1.0');
  program.option('--config <path>', 'configuration file', 'isotope.yml');
  program.command('scan').description('L2: inspect the BDG and affected sites (stub)').action(() => pending('scan'));
  program.command('verify').description('L1–L11: verify behavior (stub)').option('--no-reasoner', 'mechanical verification only').option('--no-repair', 'stop after detection and verdict').action(() => pending('verify'));
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
  program.addHelpText('after', '\nCommand forms:\n  verify --no-reasoner\n  verify --no-repair\n  repair <entry-point>\n  repair --explain <repairId>\n  spec validate|draft|list\n  fixtures normalize\n\nAll product commands are explicit stubs; no analysis or verification is performed.');
  return program;
}
