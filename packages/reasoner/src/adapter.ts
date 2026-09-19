import { GoogleGenerativeAI } from '@google/generative-ai';
import { DEFAULT_REASONER_MODEL } from './prompt';

export interface ReasonerRequest { system: string; user: string; timeoutMs: number }
export interface SemanticModel { classify(input: ReasonerRequest): Promise<string>; modelId: string }

const TIMEOUT_MS = 30_000;

function keyFrom(env: NodeJS.ProcessEnv): string {
  return (env.GEMINI_API_KEY ?? env.INPUT_GEMINI_API_KEY ?? env.GOOGLE_GENERATIVE_AI_API_KEY ?? env.GOOGLE_API_KEY ?? '').trim();
}

export function createGeminiModel(apiKey: string, modelId = DEFAULT_REASONER_MODEL): SemanticModel {
  const client = new GoogleGenerativeAI(apiKey);
  return {
    modelId,
    async classify(input) {
      const model = client.getGenerativeModel({
        model: modelId,
        systemInstruction: input.system,
        generationConfig: { temperature: 0, maxOutputTokens: 1024, responseMimeType: 'application/json' },
      });
      const result = await model.generateContent(input.user, { timeout: input.timeoutMs || TIMEOUT_MS });
      return result.response.text();
    },
  };
}

/** @deprecated Use createGeminiModel. Kept so older call sites keep compiling during the provider switch. */
export const createAnthropicModel = createGeminiModel;

export function credentialsAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(keyFrom(env));
}

export function apiKeyFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  return keyFrom(env) || null;
}
