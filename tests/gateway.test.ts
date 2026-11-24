import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { createGateway, SpendCapError, RejectedOutputError, cacheKey } from "../src/lib/gateway/gateway";
import { memoryStore } from "../src/lib/gateway/memory-store";
import { withDataGuard } from "../src/lib/gateway/data-guard";
import { SendLessViolation } from "../src/lib/gateway/redact";
import { HttpError } from "../src/lib/gateway/retry";
import type { Provider, ProviderRequest } from "../src/lib/gateway/types";

const SYSTEM = withDataGuard("Extract claims.");

/** Scripted provider: each call shifts the next behaviour off the list. */
function fakeProvider(script: Array<string | Error | ((r: ProviderRequest) => string)>) {
  const seen: ProviderRequest[] = [];
  const provider: Provider = {
    name: "fake",
    async chat(req) {
      seen.push(req);
      const next = script.shift();
      if (next === undefined) throw new Error("script exhausted");
      if (next instanceof Error) throw next;
      const text = typeof next === "function" ? next(req) : next;
      return { text, promptTokens: 10, completionTokens: 5, costUsd: 0.001 };
    },
    async embed(_m, input) {
      return { vectors: input.map(() => [0.1, 0.2]), tokens: input.length, costUsd: 0 };
    },
  };
  return { provider, seen };
}

function make(script: Parameters<typeof fakeProvider>[0], opts: { spend?: number; cap?: number } = {}) {
  const { provider, seen } = fakeProvider(script);
  const store = memoryStore({ spendTodayUsd: opts.spend ?? 0 });
  const gw = createGateway({
    provider, store,
    primaryModel: "primary", fallbackModel: "fallback", embeddingModel: "emb",
    dailyCapUsd: opts.cap ?? 1,
    sleep: async () => {}, random: () => 0,
  });
  return { gw, store, seen };
}

test("plain call logs one row with tokens and cost", async () => {
  const { gw, store } = make(["hello"]);
  const r = await gw.call({ step: "t", system: SYSTEM, user: "hi" });
  assert.equal(r.output, "hello");
  assert.equal(store.calls.length, 1);
  assert.deepEqual(
    { ok: store.calls[0].ok, cached: store.calls[0].cached, model: store.calls[0].model, cost: store.calls[0].costUsd },
    { ok: true, cached: false, model: "primary", cost: 0.001 },
  );
});

test("refuses a system prompt without the data guard", async () => {
  const { gw, seen } = make(["x"]);
  await assert.rejects(gw.call({ step: "t", system: "Extract claims.", user: "hi" }), /data-not-instructions/);
  assert.equal(seen.length, 0);
});

test("send-less guard throws before anything is sent", async () => {
  const { gw, seen } = make(["x"]);
  await assert.rejects(gw.call({ step: "t", system: SYSTEM, user: "email a@b.co" }), SendLessViolation);
  await assert.rejects(
    gw.call({ step: "t", system: SYSTEM, user: "Asha built it", founderNames: ["Asha Menon"] }),
    SendLessViolation,
  );
  assert.equal(seen.length, 0);
});

test("deterministic calls are cached; a hit is re-validated and logged at zero cost", async () => {
  const schema = z.object({ n: z.number() });
  const { gw, store, seen } = make(['{"n":1}']);
  const a = await gw.call({ step: "t", system: SYSTEM, user: "q", schema, temperature: 0 });
  const b = await gw.call({ step: "t", system: SYSTEM, user: "q", schema, temperature: 0 });
  assert.deepEqual([a.output, b.output, a.cached, b.cached], [{ n: 1 }, { n: 1 }, false, true]);
  assert.equal(seen.length, 1);
  assert.deepEqual([store.calls[1].cached, store.calls[1].costUsd], [true, 0]);
  assert.ok(store.cache.has(cacheKey("primary", SYSTEM, "q")));
});

test("an invalid cache entry is dropped and the model is called again", async () => {
  const schema = z.object({ n: z.number() });
  const { gw, store, seen } = make(['{"n":2}']);
  store.cache.set(cacheKey("primary", SYSTEM, "q"), { text: '{"n":"bad"}', model: "primary" });
  const r = await gw.call({ step: "t", system: SYSTEM, user: "q", schema });
  assert.deepEqual([r.output, r.cached, seen.length], [{ n: 2 }, false, 1]);
});

test("creative calls (temperature > 0.2) are not cached", async () => {
  const { gw, seen } = make(["a", "b"]);
  await gw.call({ step: "t", system: SYSTEM, user: "q", temperature: 0.7 });
  const r = await gw.call({ step: "t", system: SYSTEM, user: "q", temperature: 0.7 });
  assert.deepEqual([r.output, seen.length], ["b", 2]);
});

test("spend cap stops new calls but cached answers still work", async () => {
  const { gw, store } = make([], { spend: 5, cap: 1 });
  await assert.rejects(gw.call({ step: "t", system: SYSTEM, user: "q" }), SpendCapError);
  store.cache.set(cacheKey("primary", SYSTEM, "q"), { text: "cached", model: "primary" });
  assert.equal((await gw.call({ step: "t", system: SYSTEM, user: "q" })).output, "cached");
});

test("retries 5xx on the primary, then falls back after 4 tries", async () => {
  const e = () => new HttpError(503, "down");
  const { gw, store, seen } = make([e(), e(), e(), e(), "from fallback"]);
  const r = await gw.call({ step: "t", system: SYSTEM, user: "q" });
  assert.deepEqual([r.output, r.model, r.fellBack], ["from fallback", "fallback", true]);
  assert.deepEqual(seen.map((s) => s.model), ["primary", "primary", "primary", "primary", "fallback"]);
  assert.deepEqual(
    store.calls.map((c) => [c.model, c.ok, c.retries, c.fellBack]),
    [["primary", false, 3, false], ["fallback", true, 0, true]],
  );
});

test("a rejected answer is retried once with the reason", async () => {
  const schema = z.object({ claims: z.array(z.object({ quote: z.string(), page: z.number().nullable() })) });
  const check = (o: z.infer<typeof schema>) =>
    o.claims.some((c) => c.page === null) ? "every claim must cite a page" : null;
  const { gw, seen } = make([
    '{"claims":[{"quote":"x","page":null}]}',
    (req) => {
      assert.match(req.messages.at(-1)!.content, /every claim must cite a page/);
      return '{"claims":[{"quote":"x","page":3}]}';
    },
  ]);
  const r = await gw.call({ step: "t", system: SYSTEM, user: "q", schema, check });
  assert.deepEqual(r.output, { claims: [{ quote: "x", page: 3 }] });
  assert.equal(seen.length, 2);
});

test("a second rejection throws and is not cached", async () => {
  const schema = z.object({ ok: z.boolean() });
  const { gw, store } = make(['{"ok":false}', '{"ok":false}']);
  await assert.rejects(
    gw.call({ step: "t", system: SYSTEM, user: "q", schema, check: (o) => (o.ok ? null : "not ok") }),
    RejectedOutputError,
  );
  assert.equal(store.cache.size, 0);
});

test("structured calls send a JSON schema", async () => {
  const { gw, seen } = make(['{"a":"b"}']);
  await gw.call({ step: "extract", system: SYSTEM, user: "q", schema: z.object({ a: z.string() }) });
  assert.equal(seen[0].jsonSchema?.name, "extract");
  assert.equal((seen[0].jsonSchema?.schema as { type: string }).type, "object");
});

test("embeddings go through the same guard", async () => {
  const { gw } = make([]);
  assert.deepEqual(await gw.embed("e", ["portfolio one-liner"]), [[0.1, 0.2]]);
  await assert.rejects(gw.embed("e", ["mail a@b.co"]), SendLessViolation);
});
