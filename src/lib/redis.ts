import type { Redis } from "@upstash/redis";

let _redis: Redis | null = null;

/**
 * Singleton Redis client using dynamic import for webpack compatibility.
 * Uses UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN env vars.
 */
export async function getRedis(): Promise<Redis> {
  if (_redis) return _redis;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error(
      "Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN environment variables.",
    );
  }

  const { Redis: RedisClient } = await import("@upstash/redis");
  _redis = new RedisClient({ url, token });
  return _redis;
}
