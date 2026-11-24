// Retries: up to 4 tries on 429 and 5xx (and network errors), waiting
// 1s, 2s, 4s plus up to 250 ms of jitter between tries.

export const MAX_TRIES = 4;
export const BASE_DELAYS_MS = [1000, 2000, 4000];
export const MAX_JITTER_MS = 250;

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof HttpError) return err.status === 429 || err.status >= 500;
  // fetch() network failures surface as TypeError
  return err instanceof TypeError;
}

export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = BASE_DELAYS_MS[Math.min(attempt, BASE_DELAYS_MS.length - 1)];
  return base + Math.floor(random() * (MAX_JITTER_MS + 1));
}

export type RetryResult<T> = { value: T; retries: number };

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { sleep: (ms: number) => Promise<void>; random?: () => number; maxTries?: number },
): Promise<RetryResult<T>> {
  const maxTries = opts.maxTries ?? MAX_TRIES;
  let lastErr: unknown;
  let tries = 0;
  for (let attempt = 0; attempt < maxTries; attempt++) {
    tries = attempt + 1;
    try {
      return { value: await fn(), retries: attempt };
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === maxTries - 1) break;
      await opts.sleep(backoffMs(attempt, opts.random));
    }
  }
  throw Object.assign(lastErr instanceof Error ? lastErr : new Error(String(lastErr)), {
    triesUsed: tries,
  });
}
