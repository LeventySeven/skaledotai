import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createMultiAgentServiceToken,
  getMultiAgentServiceUrl,
  isAllowedMultiAgentOrigin,
  verifyMultiAgentServiceToken,
} from "@/lib/multiagent-service-auth";

const ORIGINAL_ENV = {
  MULTIAGENT_SERVICE_SHARED_SECRET: process.env.MULTIAGENT_SERVICE_SHARED_SECRET,
  MULTIAGENT_SERVICE_URL: process.env.MULTIAGENT_SERVICE_URL,
  MULTIAGENT_ALLOWED_ORIGINS: process.env.MULTIAGENT_ALLOWED_ORIGINS,
};

describe("multiagent service auth", () => {
  beforeEach(() => {
    process.env.MULTIAGENT_SERVICE_SHARED_SECRET = "test-shared-secret";
    process.env.MULTIAGENT_SERVICE_URL = "https://multiagent.example.com/";
    process.env.MULTIAGENT_ALLOWED_ORIGINS = "https://app.example.com,https://staging.example.com";
  });

  afterEach(() => {
    process.env.MULTIAGENT_SERVICE_SHARED_SECRET = ORIGINAL_ENV.MULTIAGENT_SERVICE_SHARED_SECRET;
    process.env.MULTIAGENT_SERVICE_URL = ORIGINAL_ENV.MULTIAGENT_SERVICE_URL;
    process.env.MULTIAGENT_ALLOWED_ORIGINS = ORIGINAL_ENV.MULTIAGENT_ALLOWED_ORIGINS;
  });

  test("creates and verifies a signed service token", () => {
    const { token, payload } = createMultiAgentServiceToken({
      userId: "user-123",
      origin: "https://app.example.com",
      expiresInSeconds: 60,
    });

    expect(verifyMultiAgentServiceToken(token)).toEqual(payload);
  });

  test("rejects expired tokens", () => {
    const { token } = createMultiAgentServiceToken({
      userId: "user-123",
      expiresInSeconds: -1,
    });

    expect(() => verifyMultiAgentServiceToken(token)).toThrow("expired");
  });

  test("normalizes the external service url", () => {
    expect(getMultiAgentServiceUrl()).toBe("https://multiagent.example.com");
  });

  test("checks allowed origins against the configured list", () => {
    expect(isAllowedMultiAgentOrigin("https://app.example.com")).toBe(true);
    expect(isAllowedMultiAgentOrigin("https://nope.example.com")).toBe(false);
  });
});
