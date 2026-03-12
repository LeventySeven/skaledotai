import { describe, expect, test } from "bun:test";
import {
  ImportNetworkInputSchema,
  SearchLeadInputSchema,
  XProfileSchema,
} from "@/lib/validations/search";

const BASE_PROFILE = {
  xUserId: "u-123",
  username: "alice",
  displayName: "Alice",
  bio: "Developer",
  followersCount: 5000,
  followingCount: 200,
};

describe("SearchLeadInputSchema", () => {
  test("accepts minimal valid input", () => {
    const result = SearchLeadInputSchema.safeParse({ query: "web dev" });
    expect(result.success).toBe(true);
  });

  test("accepts all optional fields", () => {
    const result = SearchLeadInputSchema.safeParse({
      query: "web dev",
      projectId: "123e4567-e89b-12d3-a456-426614174000",
      projectName: "My Project",
      followerUsername: "bob",
      minFollowers: 1000,
      targetLeadCount: 100,
    });
    expect(result.success).toBe(true);
  });

  test("rejects empty query", () => {
    expect(SearchLeadInputSchema.safeParse({ query: "" }).success).toBe(false);
  });

  test("rejects missing query", () => {
    expect(SearchLeadInputSchema.safeParse({}).success).toBe(false);
  });

  test("rejects non-uuid projectId", () => {
    expect(SearchLeadInputSchema.safeParse({ query: "test", projectId: "bad-id" }).success).toBe(false);
  });

  test("rejects negative minFollowers", () => {
    expect(SearchLeadInputSchema.safeParse({ query: "test", minFollowers: -1 }).success).toBe(false);
  });

  test("accepts zero minFollowers", () => {
    const result = SearchLeadInputSchema.safeParse({ query: "test", minFollowers: 0 });
    expect(result.success).toBe(true);
  });

  test("accepts targetLeadCount within the supported range", () => {
    expect(SearchLeadInputSchema.safeParse({ query: "test", targetLeadCount: 20 }).success).toBe(true);
    expect(SearchLeadInputSchema.safeParse({ query: "test", targetLeadCount: 180 }).success).toBe(true);
  });

  test("rejects targetLeadCount outside the supported range", () => {
    expect(SearchLeadInputSchema.safeParse({ query: "test", targetLeadCount: 19 }).success).toBe(false);
    expect(SearchLeadInputSchema.safeParse({ query: "test", targetLeadCount: 181 }).success).toBe(false);
  });
});

describe("ImportNetworkInputSchema", () => {
  test("accepts valid username", () => {
    const result = ImportNetworkInputSchema.safeParse({ username: "alice" });
    expect(result.success).toBe(true);
  });

  test("accepts with optional fields", () => {
    const result = ImportNetworkInputSchema.safeParse({
      username: "alice",
      projectId: "123e4567-e89b-12d3-a456-426614174000",
      projectName: "Alice Network",
    });
    expect(result.success).toBe(true);
  });

  test("rejects empty username", () => {
    expect(ImportNetworkInputSchema.safeParse({ username: "" }).success).toBe(false);
  });

  test("rejects missing username", () => {
    expect(ImportNetworkInputSchema.safeParse({}).success).toBe(false);
  });
});

describe("XProfileSchema", () => {
  test("accepts minimal valid profile", () => {
    const result = XProfileSchema.safeParse(BASE_PROFILE);
    expect(result.success).toBe(true);
  });

  test("accepts profile with all optional fields", () => {
    const result = XProfileSchema.safeParse({
      ...BASE_PROFILE,
      avatarUrl: "https://example.com/avatar.png",
      profileUrl: "https://twitter.com/alice",
      tweetCount: 300,
      listedCount: 10,
      verified: true,
      verifiedType: "blue",
      location: "San Francisco",
      url: "https://alice.dev",
    });
    expect(result.success).toBe(true);
  });

  test("rejects missing xUserId", () => {
    const { xUserId: _, ...without } = BASE_PROFILE;
    expect(XProfileSchema.safeParse(without).success).toBe(false);
  });

  test("rejects missing followersCount", () => {
    const { followersCount: _, ...without } = BASE_PROFILE;
    expect(XProfileSchema.safeParse(without).success).toBe(false);
  });

  test("rejects string followersCount", () => {
    expect(XProfileSchema.safeParse({ ...BASE_PROFILE, followersCount: "5000" }).success).toBe(false);
  });
});
