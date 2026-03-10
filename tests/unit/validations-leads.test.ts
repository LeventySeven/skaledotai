import { describe, expect, test } from "bun:test";
import {
  LeadPatchSchema,
  LeadSchema,
  LeadSortSchema,
  ListLeadsInputSchema,
} from "@/lib/validations/leads";

const BASE_LEAD = {
  id: "lead-1",
  name: "Alice",
  handle: "alice",
  bio: "Developer",
  platform: "twitter" as const,
  followers: 1000,
  priority: "P1" as const,
  dmComfort: true,
  theAsk: "Collab post",
  inOutreach: false,
  stage: "found" as const,
};

describe("LeadSchema", () => {
  test("accepts minimal valid lead", () => {
    const result = LeadSchema.safeParse(BASE_LEAD);
    expect(result.success).toBe(true);
  });

  test("accepts lead with all optional fields", () => {
    const result = LeadSchema.safeParse({
      ...BASE_LEAD,
      crmId: "crm-1",
      projectId: "proj-1",
      projectName: "My Project",
      xUserId: "x-123",
      following: 500,
      avatarUrl: "https://example.com/avatar.png",
      profileUrl: "https://twitter.com/alice",
      email: "alice@example.com",
      budget: 1000,
      discoverySource: "profile_search",
      discoveryQuery: "web dev",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      editable: true,
    });
    expect(result.success).toBe(true);
  });

  test("rejects missing required fields", () => {
    const { name: _name, ...withoutName } = BASE_LEAD;
    expect(LeadSchema.safeParse(withoutName).success).toBe(false);
  });

  test("rejects invalid platform", () => {
    expect(LeadSchema.safeParse({ ...BASE_LEAD, platform: "instagram" }).success).toBe(false);
  });

  test("rejects invalid stage", () => {
    expect(LeadSchema.safeParse({ ...BASE_LEAD, stage: "pending" }).success).toBe(false);
  });

  test("rejects invalid priority", () => {
    expect(LeadSchema.safeParse({ ...BASE_LEAD, priority: "P2" }).success).toBe(false);
  });

  test("rejects non-number followers", () => {
    expect(LeadSchema.safeParse({ ...BASE_LEAD, followers: "1000" }).success).toBe(false);
  });
});

describe("LeadPatchSchema", () => {
  test("accepts empty patch", () => {
    expect(LeadPatchSchema.safeParse({}).success).toBe(true);
  });

  test("accepts partial patch", () => {
    const result = LeadPatchSchema.safeParse({ stage: "messaged", dmComfort: false });
    expect(result.success).toBe(true);
  });

  test("accepts null email to clear it", () => {
    const result = LeadPatchSchema.safeParse({ email: null });
    expect(result.success).toBe(true);
  });

  test("accepts null budget to clear it", () => {
    const result = LeadPatchSchema.safeParse({ budget: null });
    expect(result.success).toBe(true);
  });

  test("rejects invalid stage", () => {
    expect(LeadPatchSchema.safeParse({ stage: "unknown" }).success).toBe(false);
  });

  test("rejects invalid priority", () => {
    expect(LeadPatchSchema.safeParse({ priority: "P3" }).success).toBe(false);
  });
});

describe("LeadSortSchema", () => {
  test.each(["followers-desc", "followers-asc", "name-asc"] as const)("accepts %s", (sort: string) => {
    expect(LeadSortSchema.parse(sort)).toBe(sort);
  });

  test("rejects invalid sort", () => {
    expect(LeadSortSchema.safeParse("name-desc").success).toBe(false);
    expect(LeadSortSchema.safeParse("").success).toBe(false);
  });
});

describe("ListLeadsInputSchema", () => {
  test("applies defaults", () => {
    const result = ListLeadsInputSchema.parse({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(25);
    expect(result.sort).toBe("followers-desc");
    expect(result.search).toBe("");
    expect(result.stage).toBe("all");
  });

  test("accepts explicit values", () => {
    const result = ListLeadsInputSchema.parse({
      page: 2,
      pageSize: 50,
      sort: "name-asc",
      search: "alice",
      projectId: "123e4567-e89b-12d3-a456-426614174000",
      inOutreach: true,
      stage: "messaged",
    });
    expect(result.page).toBe(2);
    expect(result.stage).toBe("messaged");
  });

  test("accepts stage all", () => {
    const result = ListLeadsInputSchema.parse({ stage: "all" });
    expect(result.stage).toBe("all");
  });

  test("rejects page less than 1", () => {
    expect(ListLeadsInputSchema.safeParse({ page: 0 }).success).toBe(false);
  });

  test("rejects pageSize over 100", () => {
    expect(ListLeadsInputSchema.safeParse({ pageSize: 101 }).success).toBe(false);
  });

  test("rejects non-uuid projectId", () => {
    expect(ListLeadsInputSchema.safeParse({ projectId: "not-a-uuid" }).success).toBe(false);
  });

  test("rejects invalid stage", () => {
    expect(ListLeadsInputSchema.safeParse({ stage: "pending" }).success).toBe(false);
  });
});
