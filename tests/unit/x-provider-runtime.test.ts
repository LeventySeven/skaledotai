import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const {
  getXProviderRuntimeStatuses,
  resolveXProviderForCapability,
} = await import("@/lib/x/registry");

describe("X provider runtime", () => {
  beforeEach(() => {
    process.env.X_API_BEARER_TOKEN = "test-x-api";
    process.env.TWITTERAPI_IO_KEY = "test-twitterapi";
    process.env.APIFY_TOKEN = "test-apify";
    process.env.OPENROUTER_API_KEY = "test-openrouter";
    process.env.TAVILY_API_KEY = "test-tavily";
    process.env.AGENTQL_API_KEY = "test-agentql";
    process.env.OPENAI_API_KEY = "test-openai";
  });

  test("throws when an unsupported capability is requested", () => {
    expect(resolveXProviderForCapability("openrouter", "lookup")).toMatchObject({
      requestedProvider: "openrouter",
      effectiveProvider: "x-api",
      capability: "lookup",
      usedFallback: true,
    });
  });

  test("falls back to x-api when twitterapi is selected for discovery", () => {
    expect(resolveXProviderForCapability("twitterapi", "discovery")).toMatchObject({
      requestedProvider: "twitterapi",
      effectiveProvider: "x-api",
      capability: "discovery",
      usedFallback: true,
    });
  });

  test("marks multiagent as configured when its runtime env is present", () => {
    const status = getXProviderRuntimeStatuses().find((item) => item.provider === "multiagent");
    expect(status).toBeDefined();
    expect(status?.configured).toBe(true);
    expect(status?.missingEnv).toEqual([]);
  });

  test("marks twitterapi as configured when its runtime env is present", () => {
    const status = getXProviderRuntimeStatuses().find((item) => item.provider === "twitterapi");
    expect(status).toBeDefined();
    expect(status?.configured).toBe(true);
    expect(status?.missingEnv).toEqual([]);
  });
});
