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
const screenProfilesForLeadSearchDetailedMock = mock(async (query?: unknown, candidates?: unknown, maxResults?: unknown) => ({
  selectedIds: await screenProfilesForLeadSearchMock(query, candidates, maxResults),
  batchSummaries: [],
}));
const expandLeadSearchQueriesMock = mock(async (query?: unknown): Promise<string[]> => [String(query ?? "")]);
const analyzeLeadPoolForProjectDetailedMock = mock(async () => ({
  summary: "Selected the strongest leads.",
  selectedLeadIds: [],
  usedFallback: false,
}));
mock.module("@/lib/openai", () => ({
  expandLeadSearchQueries: expandLeadSearchQueriesMock,
  screenProfilesForLeadSearch: screenProfilesForLeadSearchMock,
  screenProfilesForLeadSearchDetailed: screenProfilesForLeadSearchDetailedMock,
  rankProfilesForQuery: mock(async () => []),
  extractTopicsAndPriority: mock(async () => ({ topics: [], priority: "P1" })),
  analyzeLeadPoolForProject: mock(async () => ({
    summary: "Selected the strongest leads.",
    selectedLeadIds: [],
  })),
  analyzeLeadPoolForProjectDetailed: analyzeLeadPoolForProjectDetailedMock,
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
  screenProfilesForLeadSearchDetailedMock.mockReset();
  expandLeadSearchQueriesMock.mockReset();
  analyzeLeadPoolForProjectDetailedMock.mockReset();

  discoverCandidatesMock.mockResolvedValue([]);
  lookupUsersByUsernamesMock.mockResolvedValue([]);
  getFollowersPageMock.mockResolvedValue({ profiles: [], nextToken: undefined });
  getFollowingPageMock.mockResolvedValue({ profiles: [], nextToken: undefined });
  searchRecentPostsMock.mockResolvedValue({ tweets: [], users: [], nextToken: undefined });
  searchAllPostsMock.mockResolvedValue({ tweets: [], users: [], nextToken: undefined });
  getUserTweetsMock.mockResolvedValue([]);
  screenProfilesForLeadSearchMock.mockResolvedValue([]);
  screenProfilesForLeadSearchDetailedMock.mockImplementation(async (query?: unknown, candidates?: unknown, maxResults?: unknown) => ({
    selectedIds: await screenProfilesForLeadSearchMock(query, candidates, maxResults),
    batchSummaries: [],
  }));
  expandLeadSearchQueriesMock.mockImplementation(async (query?: unknown) => [String(query ?? "")]);
  analyzeLeadPoolForProjectDetailedMock.mockResolvedValue({
    summary: "Selected the strongest leads.",
    selectedLeadIds: [],
    usedFallback: false,
  });
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
      traceRecorder: undefined,
      snapshotRecorder: undefined,
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
      traceRecorder: undefined,
      snapshotRecorder: undefined,
    });
  });

  test("keeps the follower floor as a final filter for x-api instead of an early discovery gate", async () => {
    discoverCandidatesMock
      .mockResolvedValueOnce([
        profile({
          xUserId: "small-id",
          username: "small",
          displayName: "Small Builder",
          followersCount: 900,
        }),
        profile({
          xUserId: "qualified-one-id",
          username: "qualifiedone",
          displayName: "Qualified One",
          followersCount: 1_500,
        }),
      ])
      .mockResolvedValueOnce([
        profile({
          xUserId: "qualified-two-id",
          username: "qualifiedtwo",
          displayName: "Qualified Two",
          followersCount: 2_100,
        }),
      ]);

    expandLeadSearchQueriesMock.mockResolvedValue([
      "founding engineers",
      "founding engineers founders builders",
    ]);
    screenProfilesForLeadSearchMock.mockImplementation(async (_query: unknown, rawCandidates: unknown) => {
      const candidates = rawCandidates as Array<{ xUserId: string }>;
      return candidates.map((candidate) => candidate.xUserId);
    });

    const result = await searchAndAddLeads("user-1", {
      query: "founding engineers",
      projectName: "Founding Engineers",
      minFollowers: 1_000,
    }, "x-api");

    expect(discoverCandidatesMock).toHaveBeenNthCalledWith(1, {
      niche: "founding engineers",
      seedHandle: undefined,
      limit: 200,
      minFollowers: 0,
      traceRecorder: undefined,
      snapshotRecorder: undefined,
    });
    expect(discoverCandidatesMock).toHaveBeenNthCalledWith(2, {
      niche: "founding engineers founders builders",
      seedHandle: undefined,
      limit: 200,
      minFollowers: 0,
      traceRecorder: undefined,
      snapshotRecorder: undefined,
    });
    expect(result.leads.map((lead) => lead.handle)).toEqual(["qualifiedtwo", "qualifiedone"]);
    expect(resolveXProviderForCapabilityMock).not.toHaveBeenCalled();
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
      limit: 120,
      minFollowers: 0,
      traceRecorder: undefined,
      snapshotRecorder: undefined,
    });
    expect(discoverCandidatesMock).toHaveBeenNthCalledWith(2, {
      niche: "founding engineers founder builder engineer creator operator",
      seedHandle: undefined,
      limit: 120,
      minFollowers: 0,
      traceRecorder: undefined,
      snapshotRecorder: undefined,
    });
  });

  test("aggregates live discovery progress across retry passes", async () => {
    const streamedSteps: Array<{ id: string; title: string; bullets: string[] }> = [];
    const streamedSnapshots: Array<{ queries: number; urls: number; scraped: number; candidates: number }> = [];

    const plannerStep = {
      id: "multiagent-1-planner",
      title: "Planner",
      summary: "Generated 3 bounded discovery queries.",
      status: "success" as const,
      provider: "multiagent" as const,
      model: "gpt-5",
      bullets: ["Query 1: founding engineers"],
      metrics: [{ label: "Queries", value: 3 }],
    };

    discoverCandidatesMock
      .mockImplementationOnce(async (input?: any) => {
        await input?.traceRecorder?.(plannerStep);
        await input?.snapshotRecorder?.({ queries: 3, urls: 12, scraped: 4, candidates: 1 });
        return [
          profile({
            xUserId: "one-id",
            username: "one",
            displayName: "One Person",
            followersCount: 2400,
          }),
        ];
      })
      .mockImplementationOnce(async (input?: any) => {
        await input?.traceRecorder?.(plannerStep);
        await input?.snapshotRecorder?.({ queries: 3, urls: 12, scraped: 5, candidates: 2 });
        return [
          profile({
            xUserId: "two-id",
            username: "two",
            displayName: "Two Person",
            followersCount: 4200,
          }),
        ];
      })
      .mockImplementationOnce(async (input?: any) => {
        await input?.traceRecorder?.(plannerStep);
        await input?.snapshotRecorder?.({ queries: 3, urls: 12, scraped: 6, candidates: 3 });
        return [
          profile({
            xUserId: "three-id",
            username: "three",
            displayName: "Three Person",
            followersCount: 5100,
          }),
        ];
      });

    expandLeadSearchQueriesMock.mockResolvedValue([
      "founding engineers",
      "founding engineers founder builder engineer creator operator",
      "founding engineers startups companies teams",
    ]);
    screenProfilesForLeadSearchMock.mockResolvedValue(["one-id", "two-id", "three-id"]);

    await searchAndAddLeads("user-1", {
      query: "founding engineers",
      projectName: "Founding Engineers",
    }, "multiagent", {
      onStep: async (step) => {
        streamedSteps.push({
          id: step.id,
          title: step.title,
          bullets: step.bullets,
        });
      },
      onSnapshot: async (snapshot) => {
        streamedSnapshots.push(snapshot);
      },
    });

    const discoveryStepIds = streamedSteps
      .map((step) => step.id)
      .filter((id) => id.includes("multiagent-1-planner"));
    const discoveryStepTitles = streamedSteps
      .filter((step) => step.id.includes("multiagent-1-planner"))
      .map((step) => step.title);

    expect(discoveryStepIds).toEqual([
      "pass-1:multiagent-1-planner",
      "retry-1:multiagent-1-planner",
      "retry-2:multiagent-1-planner",
    ]);
    expect(discoveryStepTitles).toEqual([
      "Pass 1 · Planner",
      "Retry 1 · Planner",
      "Retry 2 · Planner",
    ]);
    expect(streamedSteps[0]?.bullets[0]).toBe("Discovery query: founding engineers");
    expect(streamedSteps[1]?.bullets[0]).toBe("Discovery query: founding engineers founder builder engineer creator operator");
    expect(streamedSteps[2]?.bullets[0]).toBe("Discovery query: founding engineers startups companies teams");

    expect(streamedSnapshots).toEqual(expect.arrayContaining([
      { queries: 3, urls: 12, scraped: 4, candidates: 1 },
      { queries: 6, urls: 24, scraped: 9, candidates: 3 },
      { queries: 9, urls: 36, scraped: 15, candidates: 6 },
    ]));
  });
});
