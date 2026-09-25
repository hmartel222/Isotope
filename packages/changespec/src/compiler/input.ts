import { createHash } from 'node:crypto';
import { canonicalHash, validateContract, type ChangeSpecInputPacket } from '@isotope/core';

const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_PACKET_BYTES = 512 * 1024;
const SECRET = /\b(?:sk|rk|pk|AIza)[-_A-Za-z0-9]{16,}\b|\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi;

export interface SourceInput { id: string; declaredUri?: string; mediaType: 'text/plain'|'text/markdown'|'application/json'|'application/yaml'; content: string }
export interface InputPacketOptions {
  providerHint?: string;
  dependency: { ecosystem: 'npm'|'pypi'; package: string; fromVersion: string; toVersion: string };
  supportedLanguages: Array<'ts'|'py'>;
  sources: SourceInput[];
}

function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function normalize(content: string): string { return content.replace(/\r\n?/g, '\n').replace(SECRET, '[REDACTED]').trim(); }

export function buildInputPacket(options: InputPacketOptions): ChangeSpecInputPacket {
  if (!options.sources.length) throw new Error('At least one source is required');
  const seen = new Set<string>();
  let total = 0;
  const sources = options.sources.map(source => {
    if (!source.id.trim() || seen.has(source.id)) throw new Error(`Source IDs must be non-empty and unique: ${source.id}`);
    seen.add(source.id);
    if (source.content.includes('\0')) throw new Error(`Binary source rejected: ${source.id}`);
    const content = normalize(source.content);
    const bytes = Buffer.byteLength(content);
    if (!bytes) throw new Error(`Empty source rejected: ${source.id}`);
    if (bytes > MAX_SOURCE_BYTES) throw new Error(`Source exceeds ${MAX_SOURCE_BYTES} bytes: ${source.id}`);
    total += bytes;
    return { id: source.id, ...(source.declaredUri ? { declaredUri: source.declaredUri } : {}), mediaType: source.mediaType, content, sha256: sha256(content) };
  });
  if (total > MAX_PACKET_BYTES) throw new Error(`Source packet exceeds ${MAX_PACKET_BYTES} bytes`);
  const partial = { schemaVersion: 1 as const, ...(options.providerHint ? { providerHint: options.providerHint } : {}), dependency: options.dependency, supportedLanguages: [...new Set(options.supportedLanguages)].sort(), sources };
  return validateContract('ChangeSpecInputPacket', { ...partial, inputHash: canonicalHash(partial) });
}
