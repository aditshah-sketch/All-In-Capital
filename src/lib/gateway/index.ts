// The app's gateway instance, built from environment variables.
// Default: Google Gemini (MODEL_PROVIDER=gemini). With MODEL_PROVIDER=openrouter,
// local calls go through Portkey when a Portkey key is set.

import { db } from "../db-core";
import { env, requireEnv } from "../env";
import { createGateway, type Gateway } from "./gateway";
import { openRouterProvider, portkeyProvider } from "./providers";
import { geminiProvider } from "./gemini";
import type { Provider } from "./types";
import { supabaseStore } from "./supabase-store";
import { langfuseTracer } from "./tracer";

export { withDataGuard, DATA_GUARD, findInjection } from "./data-guard";
export { redact, redactNames, redactContacts, assertSendLess, MAX_PASSAGES } from "./redact";
export { SpendCapError, RejectedOutputError } from "./gateway";

let instance: Gateway | null = null;

export function gateway(): Gateway {
  if (instance) return instance;
  const e = env();
  let provider: Provider;
  if (e.MODEL_PROVIDER === "gemini") {
    provider = geminiProvider(requireEnv("GEMINI_API_KEY"), fetch, { reasoningEffort: e.GEMINI_REASONING });
  } else {
    const openRouterKey = requireEnv("OPENROUTER_API_KEY");
    provider =
      e.NODE_ENV !== "production" && e.PORTKEY_API_KEY
        ? portkeyProvider({ portkeyKey: e.PORTKEY_API_KEY, openRouterKey })
        : openRouterProvider(openRouterKey);
  }
  instance = createGateway({
    provider,
    store: supabaseStore(db()),
    tracer: langfuseTracer({
      publicKey: e.LANGFUSE_PUBLIC_KEY,
      secretKey: e.LANGFUSE_SECRET_KEY,
      baseUrl: e.LANGFUSE_BASE_URL,
    }),
    primaryModel: e.MODEL_PRIMARY,
    fallbackModel: e.MODEL_FALLBACK,
    embeddingModel: e.EMBEDDING_MODEL,
    dailyCapUsd: e.DAILY_SPEND_CAP_USD,
  });
  return instance;
}
