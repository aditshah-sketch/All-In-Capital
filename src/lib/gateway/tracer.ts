// Langfuse tracing. We send step names, models, token counts and timings,
// never prompt or reply text: Langfuse is an outside party and the founder
// agreement forbids passing deck contents on.

import { Langfuse } from "langfuse";
import { noopTracer, type Tracer } from "./types";

export function langfuseTracer(opts: { publicKey?: string; secretKey?: string; baseUrl?: string }): Tracer {
  if (!opts.publicKey || !opts.secretKey) return noopTracer;
  const lf = new Langfuse({ publicKey: opts.publicKey, secretKey: opts.secretKey, baseUrl: opts.baseUrl });
  return {
    span(name, meta) {
      const trace = lf.trace({ name, metadata: meta });
      return { id: trace.id, end: (m) => void trace.update({ metadata: { ...meta, ...m } }) };
    },
    flush: () => lf.flushAsync(),
  };
}
