import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { validateContract, type BDG, type ChangeSpec, type IsotopeConfig, type ResolveInput } from '@isotope/core';

function sidecar(): string {
  return process.env.ISOTOPE_ACTION_PY_RUNNER
    ? resolve(process.env.ISOTOPE_ACTION_PY_RUNNER)
    : resolve(__dirname, '../../../py-runner/isotope_runner/cli.py');
}

export interface ResolverInput {
  repositoryRoot: string;
  entryPoints?: IsotopeConfig['entryPoints'];
  changeSpec: ChangeSpec;
  config: IsotopeConfig;
}

function python(payload: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('python3', [sidecar()], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = []; const err: Buffer[] = [];
    child.stdout.on('data', chunk => out.push(chunk as Buffer));
    child.stderr.on('data', chunk => err.push(chunk as Buffer));
    child.on('error', error => reject((error as NodeJS.ErrnoException).code === 'ENOENT' ? new Error('python3 is required for Python resolution') : error));
    child.on('close', () => {
      const stdout = Buffer.concat(out).toString('utf8');
      const stderr = Buffer.concat(err).toString('utf8');
      try { resolvePromise(JSON.parse(stdout) as Record<string, unknown>); }
      catch { reject(new Error(`Python resolver failed: ${stderr || stdout || 'empty output'}`)); }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

/** L2 Python: read-only AST analysis via stdlib sidecar. Same BDG contract as TypeScript. */
export async function resolveBehavioralDependencyGraph(input: ResolverInput | ResolveInput): Promise<BDG> {
  const modern = 'repositoryRoot' in input;
  const config = validateContract('IsotopeConfig', input.config);
  const spec = modern ? input.changeSpec : input.selectedSpecs.specs[0];
  if (!spec || (!modern && input.selectedSpecs.specs.length !== 1)) throw new Error('Resolver requires one explicit ChangeSpec');
  validateContract('ChangeSpec', spec);
  if (spec.verified_by !== 'human') throw new Error('Resolver requires a human-verified ChangeSpec');
  const repositoryRoot = modern ? input.repositoryRoot : input.repoRoot;
  const configured = modern ? input.entryPoints ?? config.entryPoints : config.entryPoints;
  const result = await python({ command: 'resolve', repositoryRoot, config, changeSpec: spec, entryPoints: configured });
  if (result.error) throw new Error(String((result.error as { message?: string }).message ?? result.error));
  return validateContract('BDG', result.bdg);
}
