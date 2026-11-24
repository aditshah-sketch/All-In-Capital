import type { GatewayStore, LlmCallLog } from "./types";

/** In-memory store for tests, the load test and dry runs. */
export function memoryStore(opts: { spendTodayUsd?: number } = {}) {
  const cache = new Map<string, unknown>();
  const calls: LlmCallLog[] = [];
  const store: GatewayStore & { cache: typeof cache; calls: typeof calls } = {
    cache,
    calls,
    async getCache(key) {
      return cache.has(key) ? cache.get(key)! : null;
    },
    async putCache(key, _model, response) {
      cache.set(key, response);
    },
    async dropCache(key) {
      cache.delete(key);
    },
    async logCall(row) {
      calls.push(row);
    },
    async spendTodayUsd() {
      return (opts.spendTodayUsd ?? 0) + calls.reduce((s, c) => s + c.costUsd, 0);
    },
  };
  return store;
}
