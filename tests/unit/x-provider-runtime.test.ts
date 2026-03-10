import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const {
  getXProviderRuntimeStatuses,
  resolveXProviderForCapability,
} = await import("@/lib/x/client");

describe("X provider runtime", () => {
  beforeEach(() => {
    process.env.X_API_BEARER_TOKEN = "test-x-api";
    process.env.APIFY_TOKEN = "test-apify";
    process.env.PHANTOM_TOKEN = "test-phantom";
    process.env.PHANTOMBUSTER_TWITTER_SEARCH_EXPORT_ID = "search";
    process.env.PHANTOMBUSTER_TWITTER_PROFILE_SCRAPER_ID = "profile";
    process.env.PHANTOMBUSTER_TWITTER_FOLLOWER_COLLECTOR_ID = "followers";
    process.env.PHANTOMBUSTER_TWITTER_FOLLOWING_COLLECTOR_ID = "following";
    process.env.OPENROUTER_API_KEY = "test-openrouter";
    process.env.TAVILY_API_KEY = "test-tavily";
    process.env.AGENTQL_API_KEY = "test-agentql";
    process.env.OPENAI_API_KEY = "test-openai";
    delete process.env.OXYLABS_USERNAME;
    delete process.env.OXYLABS_PASSWORD;
    delete process.env.OXYLABS_FIXTURE_READY;
    process.env.X_CAPABILITY_FALLBACK_PROVIDER = "x-api";
  });

  test("falls back from openrouter lookup to x-api", () => {
    expect(resolveXProviderForCapability("openrouter", "lookup")).toEqual({
      requestedProvider: "openrouter",
      effectiveProvider: "x-api",
      capability: "lookup",
      usedFallback: true,
    });
  });

  test("marks oxylabs as not configured until fixture gate and credentials are present", () => {
    const status = getXProviderRuntimeStatuses().find((item) => item.provider === "oxylabs");
    expect(status).toBeDefined();
    expect(status?.configured).toBe(false);
    expect(status?.missingEnv).toEqual([
      "OXYLABS_USERNAME",
      "OXYLABS_PASSWORD",
      "OXYLABS_FIXTURE_READY",
    ]);
  });
});
