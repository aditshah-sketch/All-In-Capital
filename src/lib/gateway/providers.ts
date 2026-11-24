// HTTP clients for the two routes. Both speak the OpenAI-compatible API.
// Locally we route through Portkey (observability, virtual keys); in
// production we call OpenRouter directly.

import { HttpError } from "./retry";
import type { Provider, ProviderRequest, ProviderResponse } from "./types";

type FetchFn = typeof fetch;
type ProviderJson = {
  choices?: { message?: { content?: unknown } }[];
  data?: { embedding: number[] }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
};

function body(req: ProviderRequest) {
  return {
    model: req.model,
    messages: req.messages,
    temperature: req.temperature,
    max_tokens: req.maxTokens,
    usage: { include: true },
    ...(req.jsonSchema
      ? { response_format: { type: "json_schema", json_schema: { ...req.jsonSchema, strict: true } } }
      : {}),
  };
}

async function post(fetchFn: FetchFn, url: string, headers: Record<string, string>, payload: unknown) {
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    // Never echo the request (it carries founder data); keep the provider's message short.
    const text = (await res.text().catch(() => "")).slice(0, 200);
    throw new HttpError(res.status, `Provider returned ${res.status}: ${text}`);
  }
  return res.json() as Promise<ProviderJson>;
}

function parseChat(json: ProviderJson): ProviderResponse {
  const text = json?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new HttpError(502, "Provider returned no message content");
  return {
    text,
    promptTokens: json.usage?.prompt_tokens ?? 0,
    completionTokens: json.usage?.completion_tokens ?? 0,
    costUsd: Number(json.usage?.cost ?? 0),
  };
}

export function openRouterProvider(apiKey: string, fetchFn: FetchFn = fetch): Provider {
  const base = "https://openrouter.ai/api/v1";
  const headers = { Authorization: `Bearer ${apiKey}`, "X-Title": "All In Capital triage" };
  return {
    name: "openrouter",
    async chat(req) {
      return parseChat(await post(fetchFn, `${base}/chat/completions`, headers, body(req)));
    },
    async embed(model, input) {
      const json = await post(fetchFn, `${base}/embeddings`, headers, { model, input });
      return {
        vectors: (json.data ?? []).map((d) => d.embedding),
        tokens: json.usage?.prompt_tokens ?? 0,
        costUsd: Number(json.usage?.cost ?? 0),
      };
    },
  };
}

export function portkeyProvider(
  opts: { portkeyKey: string; openRouterKey: string },
  fetchFn: FetchFn = fetch,
): Provider {
  const base = "https://api.portkey.ai/v1";
  const headers = {
    "x-portkey-api-key": opts.portkeyKey,
    "x-portkey-provider": "openrouter",
    Authorization: `Bearer ${opts.openRouterKey}`,
  };
  return {
    name: "portkey",
    async chat(req) {
      return parseChat(await post(fetchFn, `${base}/chat/completions`, headers, body(req)));
    },
    async embed(model, input) {
      const json = await post(fetchFn, `${base}/embeddings`, headers, { model, input });
      return {
        vectors: (json.data ?? []).map((d) => d.embedding),
        tokens: json.usage?.prompt_tokens ?? 0,
        costUsd: Number(json.usage?.cost ?? 0),
      };
    },
  };
}
