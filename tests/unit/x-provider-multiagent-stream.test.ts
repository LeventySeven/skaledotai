import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const {
  buildMultiAgentTraceStep,
  toMultiAgentStreamSnapshot,
} = await import("@/lib/x/multiagent");

describe("multi-agent stream mapping", () => {
  test("maps planner updates into a stable trace step", () => {
    const step = buildMultiAgentTraceStep("planner", {
      queries: [
        "founding engineers",
        "founding engineers founders builders engineers creators on x",
      ],
    }, 1, 1_000);

    expect(step.id).toBe("multiagent-1-planner");
    expect(step.title).toBe("Planner");
    expect(step.model).toBeDefined();
    expect(step.metrics).toEqual([
      { label: "Queries", value: 2 },
    ]);
    expect(step.bullets[0]).toContain("Query 1:");
  });

  test("maps values snapshots into count-based stream state", () => {
    const snapshot = toMultiAgentStreamSnapshot({
      targetLeadCount: 100,
      goalCount: 135,
      attempt: 2,
      maxAttempts: 4,
      activeNode: "profile_scraper",
      queries: ["one", "two"],
      urls: ["https://x.com/one"],
      scraped: [{ ok: true }, { ok: true }],
      candidates: [
        {
          source: "multiagent",
          niche: "founding engineers",
          discoverySource: "profile_search",
          account: {
            handle: "alice",
            name: "Alice",
            bio: "Builder",
            followers: 2_400,
            following: 120,
          },
          metrics: {
            avgLikes: 0,
            avgReplies: 0,
            avgReposts: 0,
            avgViews: 0,
            postsSampleSize: 0,
          },
          posts: [],
        },
      ],
    });

    expect(snapshot).toEqual({
      queries: 2,
      urls: 1,
      scraped: 2,
      candidates: 1,
      targetLeadCount: 100,
      goalCount: 135,
      attempt: 2,
      maxAttempts: 4,
      activeNode: "profile_scraper",
      graphNodes: [
        { id: "planner", title: "Planner", status: "complete" },
        { id: "url_finder", title: "URL Finder", status: "complete" },
        { id: "profile_scraper", title: "Profile Scraper", status: "active" },
        { id: "aggregator", title: "Aggregator", status: "idle" },
      ],
    });
  });
});
