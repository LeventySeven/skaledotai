import "@/lib/server-runtime";
import { X_PROVIDER_RETRY_BASE_DELAY_MS } from "@/lib/constants";
import type { XUserReference, XResolvedTweet } from "./types";
import { normalizeHandle, normalizeScrapedTweet, extractNestedItems } from "./normalizers";

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt += 1;
      if (attempt >= retries) throw error;
      await sleep(2 ** (attempt - 1) * X_PROVIDER_RETRY_BASE_DELAY_MS);
    }
  }
}

export function requireUsername(reference: XUserReference, provider: string): string {
  const username = normalizeHandle(reference.username);
  if (!username) {
    throw new Error(`${provider} operations require a username-backed X profile.`);
  }
  return username;
}

export function isString(value: string | undefined): value is string {
  return Boolean(value);
}

export async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  worker: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  const results: TOutput[] = new Array(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await worker(items[current], current);
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () => runWorker()),
  );

  return results;
}

export function collectNestedTweets(items: unknown[]): XResolvedTweet[] {
  const tweets: XResolvedTweet[] = [];

  for (const item of items) {
    const nestedTweets = extractNestedItems(item, "tweets");
    const sourceTweets = nestedTweets.length > 0 ? nestedTweets : [item];

    for (const candidate of sourceTweets) {
      const tweet = normalizeScrapedTweet(candidate, { excludeRepliesAndRetweets: true });
      if (tweet) tweets.push(tweet);
    }
  }

  return tweets;
}
