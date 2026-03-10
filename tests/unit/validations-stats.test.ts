import { describe, expect, test } from "bun:test";
import { GetPostStatsInputSchema, RefreshStatsInputSchema } from "@/lib/validations/stats";

const UUID = "123e4567-e89b-12d3-a456-426614174000";

describe("GetPostStatsInputSchema", () => {
  test("accepts valid uuid", () => {
    expect(GetPostStatsInputSchema.safeParse({ profileId: UUID }).success).toBe(true);
  });

  test("rejects non-uuid profileId", () => {
    expect(GetPostStatsInputSchema.safeParse({ profileId: "bad-id" }).success).toBe(false);
  });

  test("rejects missing profileId", () => {
    expect(GetPostStatsInputSchema.safeParse({}).success).toBe(false);
  });
});

describe("RefreshStatsInputSchema", () => {
  test("accepts profileId only", () => {
    expect(RefreshStatsInputSchema.safeParse({ profileId: UUID }).success).toBe(true);
  });

  test("accepts all fields", () => {
    const result = RefreshStatsInputSchema.safeParse({
      profileId: UUID,
      crmId: UUID,
      niche: "web development",
    });
    expect(result.success).toBe(true);
  });

  test("rejects non-uuid profileId", () => {
    expect(RefreshStatsInputSchema.safeParse({ profileId: "bad" }).success).toBe(false);
  });

  test("rejects non-uuid crmId", () => {
    expect(RefreshStatsInputSchema.safeParse({ profileId: UUID, crmId: "bad" }).success).toBe(false);
  });

  test("rejects missing profileId", () => {
    expect(RefreshStatsInputSchema.safeParse({}).success).toBe(false);
  });
});
