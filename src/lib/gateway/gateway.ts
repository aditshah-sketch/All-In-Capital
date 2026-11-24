// The model gateway: the ONLY code allowed to call a model (enforced by
// tests/gateway-boundary.test.ts). Every call passes, in order:
//   1. data guard   - system prompt must end with the data-not-instructions line
//   2. send-less    - no emails, phones, LinkedIn URLs, founder names, or memo dumps
//   3. spend cap    - over today's cap => SpendCapError (the queue pauses until midnight IST)
//   4. cache        - deterministic calls (temperature <= 0.2) hit a 30-day cache,
//                     re-validated on every hit and logged at zero cost
//   5. retries      - 4 tries on 429/5xx with 1s/2s/4s + jitter, then the fallback model
//   6. validation   - schema parse, then the caller's check (e.g. "every claim cites a source");
//                     a rejected answer is retried ONCE with the reason
//   7. logging      - one llm_calls row and one trace span per attempt

import { createHash } from "node:crypto";
import { z } from "zod";
import { assertDataGuard } from "./data-guard";
import { assertSendLess } from "./redact";
import { withRetry } from "./retry";
import type { ChatMessage, GatewayStore, Provider, Tracer } from "./types";
import { noopTracer } from "./types";

export const CACHE_MAX_TEMPERATURE = 0.2;

export class SpendCapError extends Error {
  constructor() {
    super("Daily spend cap reached; new work resumes after midnight IST.");
    this.name = "SpendCapError";
  }
}

export class RejectedOutputError extends Error {
  constructor(public readonly reason: string) {
    super(`Model output rejected twice: ${reason}`);
    this.name = "RejectedOutputError";
  }
}

export type GatewayDeps = {
  provider: Provider;
  store: GatewayStore;
  tracer?: Tracer;
  primaryModel: string;
  fallbackModel: string;
  embeddingModel: string;
  dailyCapUsd: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
};

export type CallInput<T> = {
  step: string;
  applicationId?: string | null;
  system: string;
  user: string;
  /** Founder names on this application; the guard throws if any leaks through. */
  founderNames?: string[];
  temperature?: number;
  maxTokens?: number;
  /** Structured output. When given, the reply is parsed as JSON and validated. */
  schema?: z.ZodType<T>;
  schemaName?: string;
  /** Extra rule (e.g. citations). Return a reason to reject, or null to accept. */
  check?: (out: T) => string | null;
};

export type CallResult<T> = { output: T; cached: boolean; model: string; fellBack: boolean };

export function cacheKey(model: string, system: string, user: string): string {
  return createHash("sha256").update(`${model}\u0000${system}\u0000${user}`).digest("hex");
}

function errMsg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

export function createGateway(deps: GatewayDeps) {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const tracer = deps.tracer ?? noopTracer;

  function parse<T>(input: CallInput<T>, text: string): { ok: true; value: T } | { ok: false; reason: string } {
    let value: unknown = text;
    if (input.schema) {
      try {
        value = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
      } catch {
        return { ok: false, reason: "reply was not valid JSON" };
      }
      const parsed = input.schema.safeParse(value);
      if (!parsed.success) return { ok: false, reason: `reply did not match the schema: ${parsed.error.issues[0]?.message}` };
      value = parsed.data;
    }
    const reason = input.check?.(value as T) ?? null;
    return reason ? { ok: false, reason } : { ok: true, value: value as T };
  }

  async function isOverCap() {
    return (await deps.store.spendTodayUsd()) >= deps.dailyCapUsd;
  }

  /** One model round trip with retries and fallback. Logs every attempt. */
  async function roundTrip<T>(input: CallInput<T>, messages: ChatMessage[], temperature: number) {
    const jsonSchema = input.schema
      ? { name: input.schemaName ?? input.step.replace(/\W/g, "_"), schema: z.toJSONSchema(input.schema) as Record<string, unknown> }
      : undefined;
    const models = [deps.primaryModel, deps.fallbackModel];
    let lastErr: unknown;
    for (let i = 0; i < models.length; i++) {
      const model = models[i];
      const span = tracer.span(`llm:${input.step}`, { model, step: input.step, applicationId: input.applicationId });
      const started = now();
      try {
        const { value, retries } = await withRetry(
          () => deps.provider.chat({ model, messages, temperature, maxTokens: input.maxTokens ?? 2000, jsonSchema }),
          { sleep, random: deps.random },
        );
        const latencyMs = now() - started;
        await deps.store.logCall({
          step: input.step, applicationId: input.applicationId, model,
          promptTokens: value.promptTokens, completionTokens: value.completionTokens, costUsd: value.costUsd,
          latencyMs, retries, fellBack: i > 0, cached: false, ok: true, traceId: span.id,
        });
        span.end({ ok: true, latencyMs, promptTokens: value.promptTokens, completionTokens: value.completionTokens });
        return { text: value.text, model, fellBack: i > 0 };
      } catch (err) {
        lastErr = err;
        const latencyMs = now() - started;
        await deps.store.logCall({
          step: input.step, applicationId: input.applicationId, model,
          promptTokens: 0, completionTokens: 0, costUsd: 0, latencyMs,
          retries: Math.max(0, ((err as { triesUsed?: number }).triesUsed ?? 1) - 1),
          fellBack: i > 0, cached: false, ok: false, error: errMsg(err).slice(0, 300), traceId: span.id,
        });
        span.end({ ok: false, error: errMsg(err) });
      }
    }
    throw lastErr;
  }

  async function call<T = string>(input: CallInput<T>): Promise<CallResult<T>> {
    assertDataGuard(input.system);
    assertSendLess(`${input.system}\n${input.user}`, { founderNames: input.founderNames });

    const temperature = input.temperature ?? 0;
    const cacheable = temperature <= CACHE_MAX_TEMPERATURE;
    const key = cacheKey(deps.primaryModel, input.system, input.user);

    if (cacheable) {
      const hit = await deps.store.getCache(key);
      if (hit !== null) {
        const parsed = parse(input, (hit as { text: string }).text);
        if (parsed.ok) {
          await deps.store.logCall({
            step: input.step, applicationId: input.applicationId, model: (hit as { model: string }).model,
            promptTokens: 0, completionTokens: 0, costUsd: 0, latencyMs: 0, retries: 0,
            fellBack: false, cached: true, ok: true,
          });
          return { output: parsed.value, cached: true, model: (hit as { model: string }).model, fellBack: false };
        }
        await deps.store.dropCache(key); // stale or invalid: never trust it again
      }
    }

    if (await isOverCap()) throw new SpendCapError();

    const messages: ChatMessage[] = [
      { role: "system", content: input.system },
      { role: "user", content: input.user },
    ];
    let first = await roundTrip(input, messages, temperature);
    let parsed = parse(input, first.text);

    if (!parsed.ok) {
      // Retry once, telling the model exactly why it was rejected.
      const retryMessages: ChatMessage[] = [
        ...messages,
        { role: "assistant", content: first.text },
        { role: "user", content: `Your answer was rejected: ${parsed.reason}. Answer again and fix exactly that.` },
      ];
      if (await isOverCap()) throw new SpendCapError();
      first = await roundTrip(input, retryMessages, temperature);
      parsed = parse(input, first.text);
      if (!parsed.ok) throw new RejectedOutputError(parsed.reason);
    }

    if (cacheable) await deps.store.putCache(key, first.model, { text: first.text, model: first.model });
    return { output: parsed.value, cached: false, model: first.model, fellBack: first.fellBack };
  }

  async function embed(step: string, texts: string[], founderNames: string[] = []): Promise<number[][]> {
    for (const t of texts) assertSendLess(t, { founderNames });
    if (await isOverCap()) throw new SpendCapError();
    const started = now();
    const span = tracer.span(`embed:${step}`, { model: deps.embeddingModel, count: texts.length });
    try {
      const { value, retries } = await withRetry(() => deps.provider.embed(deps.embeddingModel, texts), {
        sleep, random: deps.random,
      });
      await deps.store.logCall({
        step, model: deps.embeddingModel, promptTokens: value.tokens, completionTokens: 0,
        costUsd: value.costUsd, latencyMs: now() - started, retries, fellBack: false, cached: false, ok: true,
        traceId: span.id,
      });
      span.end({ ok: true });
      return value.vectors;
    } catch (err) {
      await deps.store.logCall({
        step, model: deps.embeddingModel, promptTokens: 0, completionTokens: 0, costUsd: 0,
        latencyMs: now() - started, retries: 0, fellBack: false, cached: false, ok: false,
        error: errMsg(err).slice(0, 300), traceId: span.id,
      });
      span.end({ ok: false, error: errMsg(err) });
      throw err;
    }
  }

  return { call, embed, isOverCap };
}

export type Gateway = ReturnType<typeof createGateway>;
