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

const discoverCandidatesMock = mock(async (_input?: unknown): Promise<any[]> => []);
const lookupUsersByUsernamesMock = mock(async (_usernames?: unknown): Promise<any[]> => []);
const getFollowersPageMock = mock(async (_input?: unknown): Promise<{ profiles: any[]; nextToken?: string }> => ({ profiles: [], nextToken: undefined }));
const getFollowingPageMock = mock(async (_input?: unknown): Promise<{ profiles: any[]; nextToken?: string }> => ({ profiles: [], nextToken: undefined }));
const searchRecentPostsMock = mock(async (_query?: unknown, _maxResults?: unknown, _nextToken?: unknown): Promise<{ tweets: any[]; users: any[]; nextToken?: string }> => ({ tweets: [], users: [], nextToken: undefined }));
const searchAllPostsMock = mock(async (_query?: unknown, _maxResults?: unknown, _nextToken?: unknown): Promise<{ tweets: any[]; users: any[]; nextToken?: string }> => ({ tweets: [], users: [], nextToken: undefined }));
const getUserTweetsMock = mock(async (_input?: unknown): Promise<any[]> => []);
const getXDataClientForCapabilityMock = mock((provider: string, capability: string) => ({
  client: {
    provider,
    searchUsers: discoverCandidatesMock,
    lookupUsersByUsernames: lookupUsersByUsernamesMock,
    getFollowersPage: getFollowersPageMock,
    getFollowingPage: getFollowingPageMock,
    searchRecentPosts: searchRecentPostsMock,
    searchAllPosts: searchAllPostsMock,
    getUserTweets: getUserTweetsMock,
  },
  resolution: {
    requestedProvider: provider,
    effectiveProvider: provider,
    capability,
    usedFallback: false,
  },
}));
const getXDiscoveryProviderMock = mock((provider: string) => ({
  provider: {
    provider,
    discoverCandidates: discoverCandidatesMock,
  },
  resolution: {
    requestedProvider: provider,
    effectiveProvider: provider,
    capability: "discovery",
    usedFallback: false,
  },
}));
const resolveXProviderForCapabilityMock = mock((provider: string, capability: string) => ({
  requestedProvider: provider,
  effectiveProvider: provider,
  capability,
  usedFallback: false,
}));

mock.module("@/lib/x/registry", () => ({
  getXDataClientForCapability: getXDataClientForCapabilityMock,
  getXDiscoveryProvider: getXDiscoveryProviderMock,
  resolveXProviderForCapability: resolveXProviderForCapabilityMock,
}));

const screenProfilesForLeadSearchMock = mock(async (_query?: unknown, _candidates?: unknown, _maxResults?: unknown): Promise<string[]> => []);
const expandLeadSearchQueriesMock = mock(async (query?: unknown): Promise<string[]> => [String(query ?? "")]);
mock.module("@/lib/openai", () => ({
  expandLeadSearchQueries: expandLeadSearchQueriesMock,
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
        onConflictDoUpdate: async () => [],
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
  const base = {
    xUserId: "user-1",
    username: "alice",
    displayName: "Alice",
    bio: "Founding engineer building developer tools",
    followersCount: 8_000,
    followingCount: 300,
    ...overrides,
  };

  return {
    source: "x-api" as const,
    niche: "founding engineers",
    discoverySource: "profile_search" as const,
    account: {
      handle: base.username,
      name: base.displayName,
      bio: base.bio,
      followers: base.followersCount,
      following: base.followingCount,
      xUserId: base.xUserId,
      profileUrl: `https://x.com/${base.username}`,
    },
    metrics: {
      avgLikes: 0,
      avgReplies: 0,
      avgReposts: 0,
      avgViews: 0,
      postsSampleSize: 0,
    },
    posts: [],
  };
}

beforeEach(() => {
  insertCallIndex = 0;
  insertedValues = [];
  insertMock.mockClear();
  discoverCandidatesMock.mockReset();
  lookupUsersByUsernamesMock.mockReset();
  getFollowersPageMock.mockReset();
  getFollowingPageMock.mockReset();
  searchRecentPostsMock.mockReset();
  searchAllPostsMock.mockReset();
  getUserTweetsMock.mockReset();
  getXDataClientForCapabilityMock.mockClear();
  getXDiscoveryProviderMock.mockClear();
  resolveXProviderForCapabilityMock.mockClear();
  screenProfilesForLeadSearchMock.mockReset();
  expandLeadSearchQueriesMock.mockReset();

  discoverCandidatesMock.mockResolvedValue([]);
  lookupUsersByUsernamesMock.mockResolvedValue([]);
  getFollowersPageMock.mockResolvedValue({ profiles: [], nextToken: undefined });
  getFollowingPageMock.mockResolvedValue({ profiles: [], nextToken: undefined });
  searchRecentPostsMock.mockResolvedValue({ tweets: [], users: [], nextToken: undefined });
  searchAllPostsMock.mockResolvedValue({ tweets: [], users: [], nextToken: undefined });
  getUserTweetsMock.mockResolvedValue([]);
  screenProfilesForLeadSearchMock.mockResolvedValue([]);
  expandLeadSearchQueriesMock.mockImplementation(async (query?: unknown) => [String(query ?? "")]);
});

describe("searchAndAddLeads", () => {
  test("persists only GPT-approved leads and bumps provider fetch limits", async () => {
    discoverCandidatesMock.mockResolvedValue([
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

    screenProfilesForLeadSearchMock.mockImplementation(async (_query: unknown, rawCandidates: unknown, maxResults: unknown) => {
      const candidates = rawCandidates as Array<{ username: string; xUserId: string }>;
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

    expect(discoverCandidatesMock).toHaveBeenCalledWith({
      niche: "founding engineers",
      seedHandle: undefined,
      limit: 200,
      minFollowers: 0,
    });

    const leadInsertValues = insertedValues[1] as Array<{ handle: string }>;
    expect(leadInsertValues.map((value) => value.handle)).toEqual(["austinxwalker", "dannycrichton"]);
    expect(result.leads.map((lead) => lead.handle)).toEqual(["austinxwalker", "dannycrichton"]);
    expect(result.project.sourceProviders).toEqual(["x-api"]);
  });

  test("respects the API targetLeadCount override within the new range", async () => {
    discoverCandidatesMock.mockResolvedValue([
      profile({
        xUserId: "builder-id",
        username: "builder",
        displayName: "Builder",
        bio: "Founding engineer and startup builder",
        followersCount: 9_500,
      }),
    ]);

    screenProfilesForLeadSearchMock.mockImplementation(async (_query: unknown, rawCandidates: unknown, maxResults: unknown) => {
      const candidates = rawCandidates as Array<{ xUserId: string }>;
      expect(maxResults).toBe(120);
      return candidates.map((candidate: { xUserId: string }) => candidate.xUserId);
    });

    await searchAndAddLeads("user-1", {
      query: "founding engineers",
      projectName: "Founding Engineers",
      targetLeadCount: 120,
    });

    expect(discoverCandidatesMock).toHaveBeenCalledWith({
      niche: "founding engineers",
      seedHandle: undefined,
      limit: 200,
      minFollowers: 0,
    });
  });

  test("throws NOT_FOUND when screening removes every candidate", async () => {
    discoverCandidatesMock.mockResolvedValue([
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
      message: "No relevant X leads passed AI filtering for this query.",
    });

    // Only the project insert should have happened — no lead insert.
    expect(insertCallIndex).toBe(1);
  });

  test("re-runs discovery with alternate queries when the first pass is too small", async () => {
    discoverCandidatesMock
      .mockResolvedValueOnce([
        profile({
          xUserId: "one-id",
          username: "one",
          displayName: "One Person",
          followersCount: 2400,
        }),
      ])
      .mockResolvedValueOnce([
        profile({
          xUserId: "two-id",
          username: "two",
          displayName: "Two Person",
          followersCount: 4200,
        }),
        profile({
          xUserId: "three-id",
          username: "three",
          displayName: "Three Person",
          followersCount: 5100,
        }),
      ])
      .mockResolvedValueOnce([]);

    expandLeadSearchQueriesMock.mockResolvedValue([
      "founding engineers",
      "founding engineers founder builder engineer creator operator",
      "founding engineers startups companies teams",
    ]);

    screenProfilesForLeadSearchMock.mockResolvedValue(["one-id", "two-id", "three-id"]);

    await searchAndAddLeads("user-1", {
      query: "founding engineers",
      projectName: "Founding Engineers",
    }, "apify");

    expect(discoverCandidatesMock).toHaveBeenCalledTimes(3);
    expect(discoverCandidatesMock).toHaveBeenNthCalledWith(1, {
      niche: "founding engineers",
      seedHandle: undefined,
      limit: 200,
      minFollowers: 0,
    });
    expect(discoverCandidatesMock).toHaveBeenNthCalledWith(2, {
      niche: "founding engineers founder builder engineer creator operator",
      seedHandle: undefined,
      limit: 200,
      minFollowers: 0,
    });
  });
});
