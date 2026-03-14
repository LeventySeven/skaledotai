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
    }, 1, 1_000, "gpt-5");

    expect(step.id).toBe("multiagent-1-planner");
    expect(step.title).toBe("Planner");
    expect(step.model).toBeDefined();
    expect(step.tools).toEqual(["OpenAI"]);
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
      activeNode: "scraper",
      completedNodes: ["planner", "source_fanout"],
      plannedQueries: ["one", "two"],
      candidateUrls: ["https://x.com/one"],
      scraped: [
        { url: "https://x.com/one", payload: { ok: true } },
        { url: "https://x.com/two", payload: { ok: true } },
      ],
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
      activeNode: "scraper",
      recoveryState: undefined,
      stopReason: undefined,
      firstPassCount: undefined,
      graphNodes: [
        { id: "planner", title: "Planner", status: "complete" },
        { id: "source_fanout", title: "Source Fanout", status: "complete" },
        { id: "scraper", title: "Scraper", status: "active" },
        { id: "scorer", title: "Scorer", status: "idle" },
        { id: "validator", title: "Validator", status: "idle" },
        { id: "recovery", title: "Recovery", status: "idle" },
      ],
    });
  });
});
