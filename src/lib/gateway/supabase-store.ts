import type { SupabaseClient } from "@supabase/supabase-js";
import type { GatewayStore } from "./types";

export function supabaseStore(sb: SupabaseClient): GatewayStore {
  return {
    async getCache(key) {
      const { data } = await sb
        .from("llm_cache")
        .select("response, expires_at")
        .eq("key", key)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      return data?.response ?? null;
    },
    async putCache(key, model, response) {
      await sb.from("llm_cache").upsert({
        key, model, response,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      });
    },
    async dropCache(key) {
      await sb.from("llm_cache").delete().eq("key", key);
    },
    async logCall(r) {
      const { error } = await sb.from("llm_calls").insert({
        step: r.step, application_id: r.applicationId ?? null, model: r.model,
        prompt_tokens: r.promptTokens, completion_tokens: r.completionTokens, cost_usd: r.costUsd,
        latency_ms: r.latencyMs, retries: r.retries, fell_back: r.fellBack, cached: r.cached,
        ok: r.ok, error: r.error ?? null, trace_id: r.traceId ?? null,
      });
      if (error) console.error("llm_calls insert failed:", error.message);
    },
    async spendTodayUsd() {
      const { data, error } = await sb.rpc("spend_today_usd");
      if (error) throw new Error(`Could not read today's spend: ${error.message}`);
      return Number(data ?? 0);
    },
  };
}
