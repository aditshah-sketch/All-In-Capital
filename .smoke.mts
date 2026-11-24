import { geminiProvider } from "./src/lib/gateway/gemini";
import { z } from "zod";
const p = geminiProvider(process.env.GEMINI_API_KEY!, fetch, { reasoningEffort: "low" });
const schema = z.object({ lakh: z.number() });
for (const model of ["gemini-3.5-flash", "gemini-3.5-flash-lite"]) {
  const t = Date.now();
  try {
    const r = await p.chat({ model, temperature: 0, maxTokens: 500, jsonSchema: { name: "calc", schema: z.toJSONSchema(schema) as Record<string, unknown> },
      messages: [{ role: "user", content: "How many lakh is 1.2 crore? JSON." }] });
    console.log(model, Date.now() - t, "ms valid:", schema.safeParse(JSON.parse(r.text)).success, r.text, "out tokens", r.completionTokens, "$" + r.costUsd.toFixed(6));
  } catch (e) { console.log(model, "ERR", (e as Error).message.slice(0, 120)); }
}
