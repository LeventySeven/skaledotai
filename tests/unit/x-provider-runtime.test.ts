import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const {
  getXProviderRuntimeStatuses,
  resolveXProviderForCapability,
} = await import("@/lib/x/registry");

describe("X provider runtime", () => {
  beforeEach(() => {
    process.env.X_API_BEARER_TOKEN = "test-x-api";
    process.env.APIFY_TOKEN = "test-apify";
    process.env.OPENROUTER_API_KEY = "test-openrouter";
    process.env.TAVILY_API_KEY = "test-tavily";
    process.env.AGENTQL_API_KEY = "test-agentql";
    process.env.OPENAI_API_KEY = "test-openai";
    delete process.env.OXYLABS_USERNAME;
    delete process.env.OXYLABS_PASSWORD;
    delete process.env.OXYLABS_FIXTURE_READY;
  });

  test("throws when an unsupported capability is requested", () => {
    expect(resolveXProviderForCapability("openrouter", "lookup")).toMatchObject({
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
