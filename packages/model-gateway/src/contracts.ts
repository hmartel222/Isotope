export type JsonSchema = Record<string, unknown>;

export interface StructuredModelRequest {
  system: string;
  input: string;
  schema: JsonSchema;
  timeoutMs: number;
  maxOutputTokens: number;
}

export interface StructuredModelResult<T> {
  modelId: string;
  raw: string;
  parsed?: T;
  status: 'completed' | 'invalid' | 'timeout' | 'unavailable';
  error?: string;
}

export interface StructuredModel {
  modelId: string;
  generate<T>(request: StructuredModelRequest): Promise<StructuredModelResult<T>>;
}
