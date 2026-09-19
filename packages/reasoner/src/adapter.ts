import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_REASONER_MODEL } from './prompt';

export interface ReasonerRequest { system: string; user: string; timeoutMs: number }
export interface SemanticModel { classify(input: ReasonerRequest): Promise<string>; modelId: string }

const TIMEOUT_MS = 30_000;

export function createAnthropicModel(apiKey: string, modelId = DEFAULT_REASONER_MODEL): SemanticModel {
  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS });
  return {
    modelId,
    async classify(input) {
      const response = await client.messages.create({
        model: modelId,
        max_tokens: 1024,
        system: input.system,
        messages: [{ role: 'user', content: input.user }],
      }, { timeout: input.timeoutMs });
      return response.content.map(block => block.type === 'text' ? block.text : '').join('');
    },
  };
}

export function credentialsAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean((env.ANTHROPIC_API_KEY ?? env.INPUT_ANTHROPIC_API_KEY ?? '').trim());
}

export function apiKeyFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = (env.ANTHROPIC_API_KEY ?? env.INPUT_ANTHROPIC_API_KEY ?? '').trim();
  return key || null;
}
