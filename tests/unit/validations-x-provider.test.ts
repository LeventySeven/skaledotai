import { describe, expect, test } from "bun:test";
import { XDataProviderSchema } from "@/lib/validations/x-provider";

describe("XDataProviderSchema", () => {
  test("accepts all valid providers", () => {
    for (const provider of ["x-api", "twitterapi", "apify", "multiagent", "openrouter"] as const) {
      expect(XDataProviderSchema.parse(provider)).toBe(provider);
    }
  });

  test("rejects unknown provider", () => {
    expect(XDataProviderSchema.safeParse("twitter-api").success).toBe(false);
    expect(XDataProviderSchema.safeParse("").success).toBe(false);
  });
});
