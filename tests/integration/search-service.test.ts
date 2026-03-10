import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

function chain(value: unknown): any {
  const proxy: any = new Proxy({}, {
    get(_, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve(value);
      return () => proxy;
    },
  });
  return proxy;
}

const searchUsersMock = mock(async () => []);
const lookupUsersByUsernamesMock = mock(async () => []);
const getFollowersPageMock = mock(async () => ({ profiles: [], nextToken: undefined }));
const getFollowingPageMock = mock(async () => ({ profiles: [], nextToken: undefined }));
const searchRecentPostsMock = mock(async () => ({ tweets: [], users: [], nextToken: undefined }));
const searchAllPostsMock = mock(async () => ({ tweets: [], users: [], nextToken: undefined }));
const getUserTweetsMock = mock(async () => []);

mock.module("@/lib/x/client", () => ({
  getXDataClient: mock(() => ({
    provider: "x-api",
    searchUsers: searchUsersMock,
    lookupUsersByUsernames: lookupUsersByUsernamesMock,
    getFollowersPage: getFollowersPageMock,
    getFollowingPage: getFollowingPageMock,
    searchRecentPosts: searchRecentPostsMock,
    searchAllPosts: searchAllPostsMock,
    getUserTweets: getUserTweetsMock,
  })),
}));

const screenProfilesForLeadSearchMock = mock(async () => []);
mock.module("@/lib/openai", () => ({
  screenProfilesForLeadSearch: screenProfilesForLeadSearchMock,
  rankProfilesForQuery: mock(async () => []),
  extractTopicsAndPriority: mock(async () => ({ topics: [], priority: "P1" })),
  analyzeLeadPoolForProject: mock(async () => ({
    summary: "Selected the strongest leads.",
    selectedLeadIds: [],
  })),
  generateOutreachTemplate: mock(async () => ({
    title: "Template",
    subject: "Quick note",
    body: "Hi {{name}}",
    replyRate: "35%",
  })),
}));

const NOW = new Date("2024-01-01T00:00:00.000Z");
const PROJECT_ROW = {
  id: "proj-uuid-1",
  userId: "user-1",
  name: "Founding Engineers",
  query: "founding engineers",
  seedUsername: null,
  createdAt: NOW,
};

let insertCallIndex = 0;
let insertedValues: unknown[] = [];

function toLeadRow(value: {
  userId: string;
  xUserId: string;
  name: string;
  handle: string;
  bio: string;
  platform: "twitter";
  followers: number;
  following: number;
  avatarUrl?: string;
  profileUrl?: string;
  discoverySource: string;
  discoveryQuery: string;
}, index: number) {
  return {
    id: `lead-${index + 1}`,
    userId: value.userId,
    xUserId: value.xUserId,
    name: value.name,
    handle: value.handle,
    bio: value.bio,
    platform: value.platform,
    followers: value.followers,
    following: value.following,
    avatarUrl: value.avatarUrl ?? null,
    profileUrl: value.profileUrl ?? null,
    email: null,
    budget: null,
    stage: "found",
    priority: "P1",
    dmComfort: false,
    theAsk: "",
    inOutreach: false,
    discoverySource: value.discoverySource,
    discoveryQuery: value.discoveryQuery,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const insertMock = mock(() => {
  const callIndex = insertCallIndex++;

  return {
    values(value: unknown) {
      insertedValues[callIndex] = value;

      if (callIndex === 0) {
        return {
          returning: async () => [PROJECT_ROW],
        };
      }

      if (callIndex === 1) {
        return {
          onConflictDoUpdate() {
            const rows = (value as Array<Parameters<typeof toLeadRow>[0]>).map(toLeadRow);
            return {
              returning: async () => rows,
            };
          },
        };
      }

      return {
        onConflictDoNothing: async () => [],
      };
    },
  };
});

mock.module("@/db", () => ({
  db: {
    select: mock(() => chain([])),
    update: mock(() => chain([])),
    delete: mock(() => chain([])),
    insert: insertMock,
  },
}));

const { searchAndAddLeads } = await import("@/server/services/search");

function profile(overrides: Partial<{
  xUserId: string;
  username: string;
  displayName: string;
  bio: string;
  followersCount: number;
  followingCount: number;
}> = {}) {
  return {
    xUserId: "user-1",
    username: "alice",
    displayName: "Alice",
    bio: "Founding engineer building developer tools",
    followersCount: 8_000,
    followingCount: 300,
    ...overrides,
  };
}

beforeEach(() => {
  insertCallIndex = 0;
  insertedValues = [];
  insertMock.mockClear();
  searchUsersMock.mockReset();
  lookupUsersByUsernamesMock.mockReset();
  getFollowersPageMock.mockReset();
  getFollowingPageMock.mockReset();
  searchRecentPostsMock.mockReset();
  searchAllPostsMock.mockReset();
  getUserTweetsMock.mockReset();
  screenProfilesForLeadSearchMock.mockReset();

  searchUsersMock.mockResolvedValue([]);
  lookupUsersByUsernamesMock.mockResolvedValue([]);
  getFollowersPageMock.mockResolvedValue({ profiles: [], nextToken: undefined });
  getFollowingPageMock.mockResolvedValue({ profiles: [], nextToken: undefined });
  searchRecentPostsMock.mockResolvedValue({ tweets: [], users: [], nextToken: undefined });
  searchAllPostsMock.mockResolvedValue({ tweets: [], users: [], nextToken: undefined });
  getUserTweetsMock.mockResolvedValue([]);
  screenProfilesForLeadSearchMock.mockResolvedValue([]);
});

describe("searchAndAddLeads", () => {
  test("persists only GPT-approved leads and bumps provider fetch limits", async () => {
    searchUsersMock.mockResolvedValue([
      profile({
        xUserId: "grok-id",
        username: "grok",
        displayName: "Grok",
        bio: "AI assistant for xAI",
        followersCount: 8_400_000,
      }),
      profile({
        xUserId: "austin-id",
        username: "austinxwalker",
        displayName: "Austin Walker",
        bio: "4x founder. Building for engineers.",
        followersCount: 17_300,
      }),
      profile({
        xUserId: "danny-id",
        username: "dannycrichton",
        displayName: "Danny Crichton",
        bio: "Founder and engineer writing about startups.",
        followersCount: 13_000,
      }),
    ]);

    screenProfilesForLeadSearchMock.mockImplementation(async (_query, candidates, maxResults) => {
      expect(maxResults).toBe(100);
      expect(candidates.some((candidate: { username: string }) => candidate.username === "grok")).toBe(true);
      return candidates
        .filter((candidate: { username: string }) => candidate.username !== "grok")
        .map((candidate: { xUserId: string }) => candidate.xUserId);
    });

    const result = await searchAndAddLeads("user-1", {
      query: "founding engineers",
      projectName: "Founding Engineers",
    });

    expect(searchUsersMock).toHaveBeenCalledWith("founding engineers", 100);
    expect(searchRecentPostsMock).toHaveBeenCalledWith(
      "(founding engineers) lang:en -is:retweet",
      100,
      undefined,
    );

    const leadInsertValues = insertedValues[1] as Array<{ handle: string }>;
    expect(leadInsertValues.map((value) => value.handle)).toEqual(["austinxwalker", "dannycrichton"]);
    expect(result.leads.map((lead) => lead.handle)).toEqual(["austinxwalker", "dannycrichton"]);
  });

  test("respects the API targetLeadCount override within the new range", async () => {
    searchUsersMock.mockResolvedValue([
      profile({
        xUserId: "builder-id",
        username: "builder",
        displayName: "Builder",
        bio: "Founding engineer and startup builder",
        followersCount: 9_500,
      }),
    ]);

    screenProfilesForLeadSearchMock.mockImplementation(async (_query, candidates, maxResults) => {
      expect(maxResults).toBe(120);
      return candidates.map((candidate: { xUserId: string }) => candidate.xUserId);
    });

    await searchAndAddLeads("user-1", {
      query: "founding engineers",
      projectName: "Founding Engineers",
      targetLeadCount: 120,
    });
  });

  test("throws NOT_FOUND when screening removes every candidate", async () => {
    searchUsersMock.mockResolvedValue([
      profile({
        xUserId: "grok-id",
        username: "grok",
        displayName: "Grok",
        bio: "AI assistant for xAI",
        followersCount: 8_400_000,
      }),
    ]);

    screenProfilesForLeadSearchMock.mockResolvedValue([]);

    await expect(searchAndAddLeads("user-1", {
      query: "founding engineers",
      projectName: "Founding Engineers",
    })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "No relevant X leads found for this query.",
    });

    expect(insertMock).not.toHaveBeenCalled();
  });
});
