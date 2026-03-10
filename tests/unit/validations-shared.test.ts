import { describe, expect, test } from "bun:test";
import {
  DiscoverySourceSchema,
  LeadStageSchema,
  PlatformSchema,
  PrioritySchema,
} from "@/lib/validations/shared";

describe("PlatformSchema", () => {
  test("accepts twitter", () => {
    expect(PlatformSchema.parse("twitter")).toBe("twitter");
  });

  test("rejects unknown platform", () => {
    expect(PlatformSchema.safeParse("instagram").success).toBe(false);
    expect(PlatformSchema.safeParse("").success).toBe(false);
  });
});

describe("PrioritySchema", () => {
  test("accepts P0 and P1", () => {
    expect(PrioritySchema.parse("P0")).toBe("P0");
    expect(PrioritySchema.parse("P1")).toBe("P1");
  });

  test("rejects invalid priority", () => {
    expect(PrioritySchema.safeParse("P2").success).toBe(false);
    expect(PrioritySchema.safeParse("p0").success).toBe(false);
    expect(PrioritySchema.safeParse("").success).toBe(false);
  });
});

describe("LeadStageSchema", () => {
  const valid = ["found", "messaged", "replied", "agreed"] as const;

  test.each(valid)("accepts %s", (stage: string) => {
    expect(LeadStageSchema.parse(stage)).toBe(stage);
  });

  test("rejects invalid stage", () => {
    expect(LeadStageSchema.safeParse("pending").success).toBe(false);
    expect(LeadStageSchema.safeParse("").success).toBe(false);
  });
});

describe("DiscoverySourceSchema", () => {
  const valid = [
    "profile_search",
    "post_search",
    "reply_search",
    "followers",
    "following",
  ] as const;

  test.each(valid)("accepts %s", (source: string) => {
    expect(DiscoverySourceSchema.parse(source)).toBe(source);
  });

  test("rejects invalid source", () => {
    expect(DiscoverySourceSchema.safeParse("dm").success).toBe(false);
    expect(DiscoverySourceSchema.safeParse("").success).toBe(false);
  });
});
