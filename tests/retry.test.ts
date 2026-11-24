import { test } from "node:test";
import assert from "node:assert/strict";
import { withRetry, HttpError, backoffMs, isRetryable } from "../src/lib/gateway/retry";

test("backoff is 1s, 2s, 4s plus at most 250 ms jitter", () => {
  assert.equal(backoffMs(0, () => 0), 1000);
  assert.equal(backoffMs(1, () => 0), 2000);
  assert.equal(backoffMs(2, () => 0), 4000);
  assert.equal(backoffMs(2, () => 0.9999), 4250);
});

test("retries 429/5xx up to 4 tries total, with the right waits", async () => {
  const waits: number[] = [];
  let n = 0;
  await assert.rejects(
    withRetry(async () => { n++; throw new HttpError(503, "busy"); }, { sleep: async (ms) => void waits.push(ms), random: () => 0 }),
    (e: Error & { triesUsed?: number }) => e.triesUsed === 4,
  );
  assert.equal(n, 4);
  assert.deepEqual(waits, [1000, 2000, 4000]);
});

test("succeeds after transient failures and reports retries", async () => {
  let n = 0;
  const r = await withRetry(async () => { if (++n < 3) throw new HttpError(429, "slow down"); return "ok"; }, { sleep: async () => {} });
  assert.deepEqual(r, { value: "ok", retries: 2 });
});

test("does not retry a 400", async () => {
  let n = 0;
  await assert.rejects(withRetry(async () => { n++; throw new HttpError(400, "bad"); }, { sleep: async () => {} }));
  assert.equal(n, 1);
  assert.ok(!isRetryable(new HttpError(401, "x")));
  assert.ok(isRetryable(new TypeError("fetch failed")));
});
