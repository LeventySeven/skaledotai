import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { screenProfilesForLeadSearch } = await import("@/lib/openai");

describe("OpenAI search screening fallback", () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  test("drops obvious assistant and org accounts while keeping real people", async () => {
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
        xUserId: "austin-id",
        username: "austinxwalker",
        displayName: "Austin Walker",
        bio: "4x founder. I build for engineers.",
        followersCount: 17_300,
        followingCount: 300,
        samplePosts: ["Building tools for dev teams."],
      },
    ], 10);

    expect(result).toEqual(["austin-id"]);
  });
});
