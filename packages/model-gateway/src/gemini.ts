import { GoogleGenerativeAI } from '@google/generative-ai';
import type { StructuredModel, StructuredModelRequest, StructuredModelResult } from './contracts';

const DEFAULT_TIMEOUT_MS = 30_000;

function parseJson<T>(raw: string): T {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(trimmed) as T;
}

export function geminiApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  return (env.GEMINI_API_KEY ?? env.INPUT_GEMINI_API_KEY ?? env.GOOGLE_GENERATIVE_AI_API_KEY ?? env.GOOGLE_API_KEY ?? '').trim() || null;
}

export function createGeminiStructuredModel(apiKey: string, modelId = 'gemini-3.6-flash'): StructuredModel {
  const client = new GoogleGenerativeAI(apiKey);
  return {
    modelId,
    async generate<T>(request: StructuredModelRequest): Promise<StructuredModelResult<T>> {
      try {
        const model = client.getGenerativeModel({
          model: modelId,
          systemInstruction: request.system,
          generationConfig: {
            temperature: 0,
            maxOutputTokens: request.maxOutputTokens,
            responseMimeType: 'application/json',
            responseSchema: request.schema as never,
          },
        });
        const result = await model.generateContent(request.input, { timeout: request.timeoutMs || DEFAULT_TIMEOUT_MS });
        const raw = result.response.text();
        try { return { modelId, raw, parsed: parseJson<T>(raw), status: 'completed' }; }
        catch (error) { return { modelId, raw, status: 'invalid', error: error instanceof Error ? error.message : String(error) }; }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const timeout = /timeout|aborted|deadline/i.test(message);
        return { modelId, raw: '', status: timeout ? 'timeout' : 'unavailable', error: message };
      }
    },
  };
}
