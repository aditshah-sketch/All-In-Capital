// Google Gemini through its OpenAI-compatible endpoint. This is the default
// provider. Gemini does not return a cost, so cost is computed here from token
// counts (arithmetic in code). Unknown models are priced at the most expensive
// known rate so the daily spend cap errs on the safe side.

import { HttpError } from "./retry";
import type { Provider, ProviderRequest, ProviderResponse } from "./types";

type FetchFn = typeof fetch;
type GeminiJson = {
  choices?: { message?: { content?: unknown } }[];
  data?: { embedding: number[] }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

/** Gemini 3.x bills hidden "thinking" tokens as output but leaves them out of
 *  completion_tokens; total_tokens includes them. Bill whichever is larger. */
export function billedOutputTokens(u: GeminiJson["usage"]): number {
  const prompt = u?.prompt_tokens ?? 0;
  const completion = u?.completion_tokens ?? 0;
  const total = u?.total_tokens ?? 0;
  return Math.max(completion, total - prompt);
}

/** USD per 1M tokens: [input, output]. */
// Checked Nov 2026. Google retired 2.5 for new keys. 3.5 Flash-Lite has no
// published price yet, so it is charged at the Flash rate (cap errs safe).
export const GEMINI_PRICES: Record<string, [number, number]> = {
  "gemini-3.5-flash": [1.5, 9],
  "gemini-3.5-flash-lite": [1.5, 9],
  "gemini-2.5-pro": [1.25, 10],
  "gemini-2.5-flash": [0.3, 2.5],
  "gemini-2.5-flash-lite": [0.1, 0.4],
  "gemini-embedding-001": [0.15, 0],
};
const WORST_CASE: [number, number] = [4, 20];

export function geminiCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  const id = model.replace(/^models\//, "");
  const [inp, out] = GEMINI_PRICES[id] ?? WORST_CASE;
  return (promptTokens * inp + completionTokens * out) / 1_000_000;
}

/** Gemini's schema dialect rejects a few JSON-Schema keywords zod emits. */
export function geminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === "$schema" || k === "additionalProperties") continue;
    out[k] = geminiSchema(v);
  }
  return out;
}

export function geminiProvider(
  apiKey: string,
  fetchFn: FetchFn = fetch,
  opts: { embedDims?: number; reasoningEffort?: "none" | "low" | "medium" | "high"; timeoutMs?: number } = {},
): Provider {
  const embedDims = opts.embedDims ?? 1536;
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const base = "https://generativelanguage.googleapis.com/v1beta/openai";
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };

  async function post(path: string, payload: unknown): Promise<GeminiJson> {
    // A hung request must not stall the queue: abort, and let withRetry treat it as retryable.
    let res: Response;
    try {
      res = await fetchFn(`${base}${path}`, {
        method: "POST", headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      if ((e as Error).name === "TimeoutError") throw new HttpError(504, `Gemini timed out after ${timeoutMs} ms`);
      throw e;
    }
    if (!res.ok) {
      // Never echo the request (it carries application text).
      const text = (await res.text().catch(() => "")).slice(0, 200);
      throw new HttpError(res.status, `Gemini returned ${res.status}: ${text}`);
    }
    return res.json() as Promise<GeminiJson>;
  }

  return {
    name: "gemini",
    async chat(req: ProviderRequest): Promise<ProviderResponse> {
      const json = await post("/chat/completions", {
        model: req.model,
        messages: req.messages,
        temperature: req.temperature,
        max_tokens: req.maxTokens,
        ...(opts.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}),
        ...(req.jsonSchema
          ? {
              response_format: {
                type: "json_schema",
                json_schema: { name: req.jsonSchema.name, schema: geminiSchema(req.jsonSchema.schema) },
              },
            }
          : {}),
      });
      const text = json?.choices?.[0]?.message?.content;
      if (typeof text !== "string") throw new HttpError(502, "Gemini returned no message content");
      const promptTokens = json.usage?.prompt_tokens ?? 0;
      const completionTokens = billedOutputTokens(json.usage);
      return { text, promptTokens, completionTokens, costUsd: geminiCostUsd(req.model, promptTokens, completionTokens) };
    },
    async embed(model, input) {
      const json = await post("/embeddings", { model, input, dimensions: embedDims });
      // Gemini's embeddings endpoint returns no usage; estimate ~4 chars a token.
      const tokens = json.usage?.prompt_tokens ?? Math.ceil(input.join("").length / 4);
      return { vectors: (json.data ?? []).map((d) => d.embedding), tokens, costUsd: geminiCostUsd(model, tokens, 0) };
    },
  };
}
