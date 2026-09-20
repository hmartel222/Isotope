import { Command, InvalidArgumentError } from 'commander';
import { verifyWalkingSkeleton } from './walking-skeleton';
import { scanProject } from './scan';
import { verifyRepository } from './verify-repository';
import { resolve } from 'node:path';
import { realpath } from 'node:fs/promises';
import { runDetectionMatrix } from './matrix';
import { explainRepair, repairExistingFailure } from './repair-flow';
import { explainEntry } from './explain';
import { runFleetCommand } from './fleet';
import { fixturesNormalize, specDraft, specList, specValidate } from './spec';
import { runAccuracy } from './accuracy';
export { verifyWalkingSkeleton } from './walking-skeleton';
export { scanProject } from './scan';
export { runDetectionMatrix } from './matrix';
export { verifyRepository } from './verify-repository';

export function createProgram(): Command {
  const program = new Command().exitOverride().name('isotope').description('Isotope — provider dataflow and behavioral verification').version('0.1.0');
  program.option('--config <path>', 'configuration file', 'isotope.yml');
  program.option('--specs <path>', 'ChangeSpec registry (relative to the configured repository)');
  program.option('--fixtures <path>', 'normalized fixture registry (relative to the configured repository)');
  program.command('scan').description('L2: analyze configured entry points and write the BDG').option('--spec <id>', 'ChangeSpec identifier').action(async (command: { spec?: string }) => {
    const options = program.opts<{ config: string; specs?: string }>();
    console.log(await scanProject(options.config, { ...(options.specs ? { specsPath: options.specs } : {}), ...(command.spec ? { specId: command.spec } : {}) }));
  });
  program.command('verify').description('Analyze and verify configured entry points').option('--spec <id>', 'ChangeSpec identifier').option('--no-reasoner', 'mechanical verification only').option('--no-repair', 'stop after detection and verdict').option('--base <ref>', 'local Git base revision').option('--head <ref>', 'local Git head revision').action(async (options: { reasoner: boolean; repair: boolean; spec?: string; base?: string; head?: string }) => {
    const testFixtureDirectory = process.env.ISOTOPE_TEST_FIXTURES;
    if ((options.base && !options.head) || (!options.base && options.head)) throw new InvalidArgumentError('--base and --head must be supplied together');
    const configPath = program.opts<{ config: string }>().config;
    if (options.base && options.head) {
      const configAbsolute = await realpath(resolve(configPath)); const root = resolve(configAbsolute, '..');
      const registryOptions = program.opts<{ specs?: string; fixtures?: string }>();
      const result = await verifyRepository({ repositoryRoot: root, configPath: configAbsolute, specsPath: registryOptions.specs ?? resolve(__dirname, '../../../specs'),
        fixturesPath: registryOptions.fixtures ?? resolve(__dirname, '../../../fixtures/normalized'),
        baseRef: options.base, headRef: options.head, reasoner: options.reasoner === false ? 'off' : 'on', repair: options.repair === false ? 'off' : 'on',
        ...(options.spec ? { specId: options.spec } : {}), ...(testFixtureDirectory ? { testFixtureDirectory } : {}) });
      console.log(result.output); process.exitCode = result.exitCode; return;
    }
    const globalOptions = program.opts<{ specs?: string; fixtures?: string }>();
    const analysis = await import('./scan').then(module => module.analyzeConfiguredProject(configPath, undefined, globalOptions.specs, options.spec));
    const result = await verifyWalkingSkeleton({ configPath, selectedSpecs: analysis.selected,
      ...(globalOptions.fixtures ? { fixtureRoot: resolve(analysis.projectRoot, globalOptions.fixtures) } : {}),
      disableReasoner: options.reasoner === false, disableRepair: options.repair === false, ...(testFixtureDirectory ? { testFixtureDirectory } : {}) });
    console.log(result.output);
    process.exitCode = result.exitCode;
  });
  program.command('repair [entry-point]').description('Verify a repair for an existing FAIL or FAIL_REASONED').option('--explain <repairId>', 'explain an existing repair').action(async (entry: string | undefined, options: { explain?: string }) => {
    if ((!entry && !options.explain) || (entry && options.explain)) throw new InvalidArgumentError('provide either an entry-point or --explain <repairId>');
    if (options.explain) {
      const result = await explainRepair({ configPath: program.opts<{ config: string }>().config, repairId: options.explain });
      console.log(result.output); process.exitCode = result.exitCode; return;
    }
    const result = await repairExistingFailure({ configPath: program.opts<{ config: string }>().config, entryPoint: entry!, ...(process.env.ISOTOPE_TEST_FIXTURES ? { testFixtureDirectory: process.env.ISOTOPE_TEST_FIXTURES } : {}) });
    console.log(result.output); process.exitCode = result.exitCode;
  });
  program.command('explain <entry-point>').description('Inspect signatures, diff, and reasoning').action(async (entry: string) => {
    const result = await explainEntry(program.opts<{ config: string }>().config, entry);
    console.log(result.output); process.exitCode = result.exitCode;
  });
  program.command('fleet').description('Run batch analysis and produce a static dashboard').option('--repos <path>', 'repository manifest').option('--spec <id>', 'ChangeSpec identifier').option('--out <path>', 'dashboard file').option('--reason', 'enable reasoning').option('--repair', 'enable repair').action(async (options: { repos?: string; spec?: string; out?: string; reason?: boolean; repair?: boolean }) => {
    const result = await runFleetCommand({ ...options, configPath: program.opts<{ config: string }>().config });
    console.log(result.output); process.exitCode = result.exitCode;
  });
  const spec = program.command('spec').description('ChangeSpec management');
  spec.command('validate [path]').description('Validate ChangeSpecs').action(async (path?: string) => {
    const result = await specValidate(path); console.log(result.output); process.exitCode = result.exitCode;
  });
  spec.command('draft').description('Draft a ChangeSpec').requiredOption('--url <url>', 'changelog URL').requiredOption('--provider <provider>', 'provider name').option('--out <path>', 'destination yaml').action(async (options: { url: string; provider: string; out?: string }) => {
    const result = await specDraft(options.url, options.provider, options.out); console.log(result.output); process.exitCode = result.exitCode;
  });
  spec.command('list').description('List ChangeSpecs').action(async () => {
    const result = await specList(); console.log(result.output); process.exitCode = result.exitCode;
  });
  program.command('fixtures').description('Provider fixture management').command('normalize').option('--raw <path>', 'raw fixture directory').option('--out <path>', 'normalized fixture directory').option('--pair <id>', 'pair id').action(async (options: { raw?: string; out?: string; pair?: string }) => {
    const result = await fixturesNormalize(options.raw, options.out, options.pair); console.log(result.output); process.exitCode = result.exitCode;
  });
  program.command('matrix').description('Run the acceptance matrix')
    .option('--group <group>', 'matrix group', 'detection').option('--case <id>', 'run one case')
    .option('--keep-artifacts', 'retain temporary case repositories').option('--allow-blocked', 'do not fail for unavailable cases')
    .action(async (options: { group: string; case?: string; keepArtifacts?: boolean; allowBlocked?: boolean }) => {
      if (!['detection', 'acceptance', 'all'].includes(options.group)) throw new InvalidArgumentError('group must be detection, acceptance, or all');
      const result = await runDetectionMatrix({ group: options.group, ...(options.case ? { caseId: options.case } : {}), keepArtifacts: options.keepArtifacts === true, allowBlocked: options.allowBlocked === true });
      console.log(result.output); process.exitCode = result.exitCode;
    });
  program.command('accuracy').description('Run the historical/local accuracy benchmark').action(async () => {
    const result = await runAccuracy(); console.log(result.output); process.exitCode = result.exitCode;
  });
  program.addHelpText('after', '\nCommand forms:\n  verify --no-reasoner\n  verify --no-repair\n  repair <entry-point>\n  repair --explain <repairId>\n  spec validate|draft|list\n  fixtures normalize\n\nscan performs static analysis only. verify uses the generated BDG and isolated harness. Repairs are isolated and independently verified. Semantic reasoning is optional and never overrides a mechanical FAIL. The planner never verifies its own work.');
  return program;
}
