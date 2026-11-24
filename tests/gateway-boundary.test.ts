// The gateway is the ONLY module allowed to call a model. This test scans the
// codebase for model endpoints and SDKs outside src/lib/gateway/.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SCAN = ["src", "scripts"];
const ALLOWED = join("src", "lib", "gateway");

const FORBIDDEN = [
  /openrouter\.ai/i,
  /api\.portkey\.ai/i,
  /api\.openai\.com/i,
  /api\.anthropic\.com/i,
  /\/chat\/completions/,
  /\/v1\/embeddings/,
  /from ["']@anthropic-ai\//,
  /from ["']openai["']/,
  /from ["']portkey-ai["']/,
  /from ["']@google\/genai["']/,
];

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx|js|mjs|mts)$/.test(name)) yield p;
  }
}

test("only src/lib/gateway calls a model", () => {
  const offenders: string[] = [];
  for (const top of SCAN) {
    let files: string[] = [];
    try { files = [...walk(join(ROOT, top))]; } catch { continue; }
    for (const f of files) {
      const rel = relative(ROOT, f);
      if (rel.startsWith(ALLOWED)) continue;
      const src = readFileSync(f, "utf8");
      for (const re of FORBIDDEN) if (re.test(src)) offenders.push(`${rel} matches ${re}`);
    }
  }
  assert.deepEqual(offenders, []);
});
