import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const {
  buildTavilySearchRequest,
  buildAgentQlQueryRequest,
  buildMultiAgentHeuristicQueries,
  normalizeDiscoveredUrls,
} = await import("@/lib/x/multiagent");

describe("Multi-agent request builders", () => {
  test("builds deterministic heuristic queries for planner fallback", () => {
    expect(buildMultiAgentHeuristicQueries({
      niche: "founding engineers",
      seedHandle: "austinxwalker",
      limit: 25,
      minFollowers: 5000,
    })).toEqual([
      "founding engineers",
      "founding engineers founders builders engineers creators on x",
      "founding engineers real people personal accounts on x",
    ]);
  });

  test("uses Tavily request body auth and domain filters", () => {
    process.env.TAVILY_API_KEY = "test-tavily";
    expect(buildTavilySearchRequest("founding engineers", 25)).toEqual({
      api_key: "test-tavily",
      query: "founding engineers",
      search_depth: "basic",
      include_domains: ["x.com", "twitter.com"],
      max_results: 13,
    });
  });

  test("builds AgentQL query_data payload", () => {
    const payload = buildAgentQlQueryRequest("https://x.com/austinxwalker") as {
      url: string;
      query: string;
      params: {
        wait_for: number;
        mode: string;
        browser_profile: string;
        is_screenshot_enabled: boolean;
      };
    };

    expect(payload.url).toBe("https://x.com/austinxwalker");
    expect(payload.query).toContain("{");
    expect(payload.query).toContain("tweets[]");
    expect(payload.query).toContain("followers_count(integer)");
    expect(payload.params.mode).toBe("fast");
    expect(payload.params.browser_profile).toBe("stealth");
  });

  test("can build a lighter AgentQL profile-only payload", () => {
    const payload = buildAgentQlQueryRequest("https://x.com/austinxwalker", "profile") as {
      query: string;
    };

    expect(payload.query).toContain("profile {");
    expect(payload.query).not.toContain("tweets[]");
  });

  test("canonicalizes Tavily x urls down to unique profile pages", () => {
    expect(normalizeDiscoveredUrls([
      { url: "https://x.com/austinxwalker/status/12345" },
      { url: "https://twitter.com/austinxwalker" },
      { url: "https://x.com/search?q=founding%20engineers&f=user" },
      { url: "https://x.com/jack/" },
    ], 10)).toEqual([
      "https://x.com/austinxwalker",
      "https://x.com/jack",
    ]);
  });
});
