/**
 * One polling helper for the whole product.
 *
 * There were 38 hand-written poll loops across the apps, each with its own
 * interval, its own idea of a timeout, and most with no backoff and no abort.
 * They are the reason a closed tab used to strand a job: the loop was the only
 * thing advancing it. Server work now advances on the dispatcher, and the
 * browser uses this to watch a row.
 */

export interface PollOptions<T> {
  /** Milliseconds between attempts. Default 5000 — the standard row watch. */
  interval?: number;
  /** Give up after this long. Default 15 minutes, matching the server timeout. */
  timeout?: number;
  /** Stop when this returns true. Required. */
  until: (value: T) => boolean;
  /** Multiply the interval after each attempt, capped at maxInterval. Default 1 (no backoff). */
  backoff?: number;
  maxInterval?: number;
  /** Called after every attempt, including ones that did not satisfy `until`. */
  onTick?: (value: T, attempt: number) => void;
  /**
   * Consecutive thrown errors tolerated before giving up. A provider blipping
   * once should not fail a render that is still running. Default 5.
   */
  tolerateErrors?: number;
  signal?: AbortSignal;
}

export class PollTimeoutError extends Error {
  constructor(ms: number) {
    super(`Still working after ${Math.round(ms / 1000)}s.`);
    this.name = 'PollTimeoutError';
  }
}

export class PollAbortedError extends Error {
  constructor() {
    super('Cancelled.');
    this.name = 'PollAbortedError';
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Call `fn` until `until(result)` is true, then return that result.
 *
 * Throws PollTimeoutError on timeout, PollAbortedError when the signal fires,
 * and rethrows the last error once `tolerateErrors` consecutive attempts fail.
 */
export async function poll<T>(fn: () => Promise<T>, options: PollOptions<T>): Promise<T> {
  const {
    interval = 5_000,
    timeout = 15 * 60 * 1_000,
    until,
    backoff = 1,
    maxInterval = 30_000,
    onTick,
    tolerateErrors = 5,
    signal,
  } = options;

  const deadline = Date.now() + timeout;
  let wait = interval;
  let attempt = 0;
  let consecutiveErrors = 0;
  let lastError: unknown = null;

  for (;;) {
    if (signal?.aborted) throw new PollAbortedError();

    attempt += 1;
    try {
      const value = await fn();
      consecutiveErrors = 0;
      onTick?.(value, attempt);
      if (until(value)) return value;
    } catch (error) {
      lastError = error;
      consecutiveErrors += 1;
      if (consecutiveErrors >= tolerateErrors) throw error;
    }

    if (Date.now() + wait >= deadline) throw new PollTimeoutError(timeout);
    await sleep(wait);
    if (backoff > 1) wait = Math.min(Math.round(wait * backoff), maxInterval);
  }
}

/**
 * Watch one job row on the standard 5-second beat.
 *
 * This is the only polling a page should ever do. The row is advanced by the
 * server dispatcher, so closing the tab stops the watching, not the work.
 */
export function watchJobRow<T>(
  read: () => Promise<T>,
  isDone: (row: T) => boolean,
  options: Omit<PollOptions<T>, 'until'> = {},
): Promise<T> {
  return poll(read, { interval: 5_000, timeout: 30 * 60 * 1_000, ...options, until: isDone });
}
