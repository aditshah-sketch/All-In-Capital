import { test } from "node:test";
import assert from "node:assert/strict";
import { geminiProvider, geminiCostUsd, geminiSchema } from "../src/lib/gateway/gemini";

test("cost is computed in code from tokens", () => {
  assert.equal(geminiCostUsd("gemini-2.5-flash", 1_000_000, 0), 0.3);
  assert.equal(geminiCostUsd("gemini-2.5-flash", 0, 1_000_000), 2.5);
  // unknown models get the worst-case price so the cap errs safe
  assert.equal(geminiCostUsd("gemini-9-ultra", 1_000_000, 1_000_000), 14);
});

test("schema drops keywords Gemini rejects", () => {
  const s = geminiSchema({ $schema: "x", type: "object", additionalProperties: false, properties: { a: { type: "object", additionalProperties: false } } });
  assert.deepEqual(s, { type: "object", properties: { a: { type: "object" } } });
});

test("chat posts to the OpenAI-compatible endpoint and prices the call", async () => {
  let url = "", sent: Record<string, unknown> = {};
  const fake = (async (u: string, init: RequestInit) => {
    url = u; sent = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 1000, completion_tokens: 100 } }));
  }) as unknown as typeof fetch;
  const p = geminiProvider("k", fake);
  const r = await p.chat({ model: "gemini-2.5-flash", messages: [{ role: "user", content: "hi" }], temperature: 0, maxTokens: 10, jsonSchema: { name: "x", schema: { $schema: "s", type: "object" } } });
  assert.match(url, /generativelanguage\.googleapis\.com\/v1beta\/openai\/chat\/completions$/);
  assert.deepEqual((sent.response_format as { json_schema: { schema: unknown } }).json_schema.schema, { type: "object" });
  assert.ok(Math.abs(r.costUsd - (1000 * 0.3 + 100 * 2.5) / 1e6) < 1e-12);
});

test("embeddings request 1536 dimensions to match the schema", async () => {
  let sent: Record<string, unknown> = {};
  const fake = (async (_u: string, init: RequestInit) => {
    sent = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ data: [{ embedding: [0.1] }], usage: { prompt_tokens: 5 } }));
  }) as unknown as typeof fetch;
  const r = await geminiProvider("k", fake).embed("gemini-embedding-001", ["a"]);
  assert.equal(sent.dimensions, 1536);
  assert.deepEqual(r.vectors, [[0.1]]);
});

test("HTTP errors surface the status without echoing the request", async () => {
  const fake = (async () => new Response("quota", { status: 429 })) as unknown as typeof fetch;
  await assert.rejects(geminiProvider("k", fake).chat({ model: "m", messages: [{ role: "user", content: "SECRET DECK TEXT" }], temperature: 0, maxTokens: 1 }), (e: Error & { status?: number }) => e.status === 429 && !e.message.includes("SECRET"));
});
