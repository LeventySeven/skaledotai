import { describe, expect, test } from "bun:test";
import { XDataProviderSchema } from "@/lib/validations/x-provider";

describe("XDataProviderSchema", () => {
  test.each(["x-api", "apify", "phantombuster"] as const)("accepts %s", (provider: string) => {
    expect(XDataProviderSchema.parse(provider)).toBe(provider);
  });

  test("rejects unknown provider", () => {
    expect(XDataProviderSchema.safeParse("twitter-api").success).toBe(false);
    expect(XDataProviderSchema.safeParse("").success).toBe(false);
  });
});
