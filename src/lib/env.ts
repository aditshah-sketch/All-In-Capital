// Keys live only in environment variables. This module validates them lazily
// so tests and scripts that don't need a key never require it.

import { z } from "zod";

const list = z
  .string()
  .default("")
  .transform((s) => s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean));

const schema = z.object({
  APP_ENV: z.enum(["test", "live"]).default("test"),
  NODE_ENV: z.string().default("development"),

  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  MODEL_PROVIDER: z.enum(["gemini", "openrouter"]).default("gemini"),
  GEMINI_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  PORTKEY_API_KEY: z.string().optional(),
  MODEL_PRIMARY: z.string().default("gemini-3.5-flash"),
  MODEL_FALLBACK: z.string().default("gemini-3.5-flash-lite"),
  GEMINI_REASONING: z.enum(["none", "low", "medium", "high"]).default("low"),
  EMBEDDING_MODEL: z.string().default("gemini-embedding-001"),
  DAILY_SPEND_CAP_USD: z.coerce.number().positive().default(3),

  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_BASE_URL: z.string().url().optional(),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  ALLOWED_EMAILS: list,
  PARTNER_EMAILS: list,
  MAILBOX_EMAIL: z.string().default("").transform((s) => s.trim().toLowerCase()),
  DEEPTECH_PARTNER_EMAIL: z.string().default(""),

  CRON_SECRET: z.string().optional(),
  APP_URL: z.string().default("http://localhost:3000"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;
export function env(): Env {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}

export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const v = env()[key];
  if (v === undefined || v === null || v === "") throw new Error(`Missing environment variable ${String(key)}`);
  return v as NonNullable<Env[K]>;
}

/** For tests: forget the parsed env so a changed process.env is re-read. */
export function resetEnvCache() {
  cached = null;
}
