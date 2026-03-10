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
  test("accepts all valid stages", () => {
    for (const stage of ["found", "messaged", "replied", "agreed"] as const) {
      expect(LeadStageSchema.parse(stage)).toBe(stage);
    }
  });

  test("rejects invalid stage", () => {
    expect(LeadStageSchema.safeParse("pending").success).toBe(false);
    expect(LeadStageSchema.safeParse("").success).toBe(false);
  });
});

describe("DiscoverySourceSchema", () => {
  test("accepts all valid sources", () => {
    for (const source of ["profile_search", "post_search", "reply_search", "followers", "following"] as const) {
      expect(DiscoverySourceSchema.parse(source)).toBe(source);
    }
  });

  test("rejects invalid source", () => {
    expect(DiscoverySourceSchema.safeParse("dm").success).toBe(false);
    expect(DiscoverySourceSchema.safeParse("").success).toBe(false);
  });
});
