import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { screenProfilesForLeadSearch, expandLeadSearchQueries } = await import("@/lib/openai");

describe("OpenAI search screening fallback", () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  test("drops obvious impossible accounts while keeping real people and relevant companies", async () => {
    const result = await screenProfilesForLeadSearch("founding engineers", [
      {
        xUserId: "grok-id",
        username: "grok",
        displayName: "Grok",
        bio: "AI assistant for xAI",
        followersCount: 8_400_000,
        followingCount: 0,
        samplePosts: ["Ask Grok anything."],
      },
      {
        xUserId: "amplify-id",
        username: "AmplifyPartners",
        displayName: "Amplify Partners",
        bio: "The first investor for technical founders.",
        followersCount: 7_300,
        followingCount: 120,
        samplePosts: ["We invest in technical founders."],
      },
      {
        xUserId: "elon-id",
        username: "elonmusk",
        displayName: "Elon Musk",
        bio: "Technoking of Tesla, CTO of SpaceX",
        followersCount: 200_000_000,
        followingCount: 1000,
        samplePosts: ["Mars is important."],
      },
      {
        xUserId: "austin-id",
        username: "austinxwalker",
        displayName: "Austin Walker",
        bio: "4x founder. I build for engineers.",
        followersCount: 17_300,
        followingCount: 300,
        samplePosts: ["Building tools for dev teams."],
      },
    ], 10);

    expect(result).toEqual(["austin-id", "amplify-id"]);
  });

  test("keeps plausible people even when niche fit is only borderline", async () => {
    const result = await screenProfilesForLeadSearch("founding engineers", [
      {
        xUserId: "builder-id",
        username: "buildermax",
        displayName: "Max Rivera",
        bio: "building products, sharing progress, writing code",
        followersCount: 2200,
        followingCount: 500,
        samplePosts: ["shipping a new project this week", "writing code again tonight"],
      },
    ], 10);

    expect(result).toEqual(["builder-id"]);
  });

  test("expands discovery queries with broader role and company variants", async () => {
    const result = await expandLeadSearchQueries("founding engineers");
    expect(result[0]).toBe("founding engineers");
    expect(result.some((item) => /companies|founders|builders/i.test(item))).toBe(true);
  });
});
