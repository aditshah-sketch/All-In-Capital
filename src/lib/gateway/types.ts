export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ProviderRequest = {
  model: string;
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number;
  jsonSchema?: { name: string; schema: Record<string, unknown> };
};

export type ProviderResponse = {
  text: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
};

export interface Provider {
  name: string;
  chat(req: ProviderRequest): Promise<ProviderResponse>;
  embed(model: string, input: string[]): Promise<{ vectors: number[][]; tokens: number; costUsd: number }>;
}

export type LlmCallLog = {
  step: string;
  applicationId?: string | null;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  latencyMs: number;
  retries: number;
  fellBack: boolean;
  cached: boolean;
  ok: boolean;
  error?: string | null;
  traceId?: string | null;
};

/** Persistence the gateway needs. Supabase in the app, in-memory in tests. */
export interface GatewayStore {
  getCache(key: string): Promise<unknown | null>;
  putCache(key: string, model: string, response: unknown): Promise<void>;
  dropCache(key: string): Promise<void>;
  logCall(row: LlmCallLog): Promise<void>;
  spendTodayUsd(): Promise<number>;
}

export interface Tracer {
  span(name: string, meta: Record<string, unknown>): { id: string | null; end(meta: Record<string, unknown>): void };
  flush(): Promise<void>;
}

export const noopTracer: Tracer = {
  span: () => ({ id: null, end: () => {} }),
  flush: async () => {},
};
