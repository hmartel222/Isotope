const test = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { bindProject } = require('@isotope/changespec');

const root = resolve(__dirname, '..');
const citation = { sourceId: 'reviewed.md', excerpt: 'reviewed evidence' };
function candidate({ provider, versions, ecosystem, packageName, breakingFrom, language, receiver, members, object, removedPath, removedSymbol, replacement }) {
  return {
    schemaVersion: 1, provider, title: `${provider} compatibility`, describedVersions: versions,
    semantics: 'reviewed compatibility candidate', dependencyProposal: { ecosystem, package: packageName, breakingFrom },
    taintRoots: [{ kind: 'call', language, receiver, members, argumentMode: 'wildcard' }],
    changes: [{ object, ...(removedPath ? { removedPath: { segments: removedPath.split('.').map(name => ({ kind: 'property', name })) } } : {}), ...(removedSymbol ? { removedSymbol } : {}), replacement: { path: { segments: replacement.split('.').map(name => ({ kind: 'property', name })) }, cardinality: 'one' }, codemod: { kind: 'unsupported' }, citations: { removed: [citation], replacement: [citation] } }],
    semanticsCitations: [citation], unknowns: [], unsupportedFeatures: [], suspectedInjection: false, abstain: false,
  };
}

test('production TypeScript resolver binds the reviewed Stripe root to a real source location', async () => {
  const dependency = { ecosystem: 'npm', package: 'stripe', fromVersion: '17.7.0', toVersion: '18.1.0' };
  const result = await bindProject(candidate({ provider: 'stripe', versions: { from: dependency.fromVersion, to: dependency.toVersion }, ecosystem: 'npm', packageName: 'stripe', breakingFrom: '18.0.0', language: 'ts', receiver: 'stripe', members: ['webhooks', 'constructEvent'], object: 'subscription', removedPath: 'current_period_end', replacement: 'items.data.current_period_end' }), dependency, resolve(root, 'corpus/cases/repositories/mechanical-break'));
  assert.equal(result.status, 'bound', result.diagnostics?.join('\n'));
  assert.ok(result.matches.some(match => match.file === 'src/webhook.ts' && match.line === 5 && match.provenance === 'provider_call'));
});

test('production Python resolver binds the reviewed ElevenLabs root to a real source location', async () => {
  const dependency = { ecosystem: 'pypi', package: 'elevenlabs', fromVersion: '0.2.27', toVersion: '1.0.0' };
  const result = await bindProject(candidate({ provider: 'elevenlabs', versions: { from: dependency.fromVersion, to: dependency.toVersion }, ecosystem: 'pypi', packageName: 'elevenlabs', breakingFrom: '1.0.0', language: 'py', receiver: 'el', members: ['generate'], object: 'generate', removedPath: 'voice', removedSymbol: 'generate', replacement: 'voice_id' }), dependency, resolve(root, 'corpus/cases/repositories/python-elevenlabs'));
  assert.equal(result.status, 'bound', result.diagnostics?.join('\n'));
  assert.ok(result.matches.some(match => match.file === 'handler.py' && match.line === 5 && match.provenance === 'provider_call'));
});

test('resolver binding rejects a provider-shaped call imported from an unrelated module', async () => {
  const dependency = { ecosystem: 'npm', package: 'not-stripe', fromVersion: '1.0.0', toVersion: '2.0.0' };
  const result = await bindProject(candidate({ provider: 'other', versions: { from: dependency.fromVersion, to: dependency.toVersion }, ecosystem: 'npm', packageName: 'not-stripe', breakingFrom: '2.0.0', language: 'ts', receiver: 'stripe', members: ['webhooks', 'constructEvent'], object: 'subscription', removedPath: 'current_period_end', replacement: 'items.data.current_period_end' }), dependency, resolve(root, 'corpus/cases/repositories/mechanical-break'));
  assert.equal(result.status, 'unbound');
});
