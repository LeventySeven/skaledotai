import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { buildApifyAdvancedSearchInput, buildApifyUserScraperInput, buildApifyDiscoveryQueries } = await import("@/lib/x/apify");
const { buildOpenRouterDiscoveryRequest } = await import("@/lib/x/openrouter");
const { buildTavilySearchRequest, buildAgentQlQueryRequest, buildMultiAgentHeuristicQueries } = await import("@/lib/x/multiagent");
const { buildOxylabsDiscoveryUrls } = await import("@/lib/x/oxylabs");

describe("Apify payload builders", () => {
  test("expands simple discovery queries for better lead coverage", () => {
    expect(buildApifyDiscoveryQueries("founding engineers")).toEqual([
      "founding engineers",
      "\"founding engineers\"",
      "founding engineers founder",
      "founding engineers builder",
      "founding engineers engineer",
      "founding engineers creator",
    ]);
  });

  test("keeps structured queries intact", () => {
    expect(buildApifyDiscoveryQueries("to:austinxwalker founding engineers")).toEqual([
      "to:austinxwalker founding engineers",
    ]);
  });

  test("uses documented advanced search fields", () => {
    expect(buildApifyAdvancedSearchInput("founding engineers", 80)).toEqual({
      query: "founding engineers",
      numberOfTweets: 80,
    });
  });

  test("uses documented twitter-user-scraper fields", () => {
    expect(buildApifyUserScraperInput(["@alice", "bob"], {
      getFollowers: true,
      maxItems: 42,
    })).toEqual({
      twitterHandles: ["@alice", "@bob"],
      getFollowers: true,
      getFollowing: false,
      maxItems: 42,
    });
  });
});

describe("OpenRouter request builder", () => {
  test("uses web search plus strict json schema output", () => {
    process.env.TAVILY_API_KEY = "test-tavily";
    const payload = buildOpenRouterDiscoveryRequest({
      niche: "founding engineers",
      seedHandle: "austinxwalker",
      limit: 25,
      minFollowers: 5000,
    }) as {
      model: string;
      plugins: Array<{ id: string; engine: string }>;
      response_format: { type: string; json_schema: { strict: boolean } };
    };

    expect(payload.model).toBe("x-ai/grok-4.1-fast");
    expect(payload.plugins[0]?.id).toBe("web");
    expect(payload.plugins[0]?.engine).toBe("native");
    expect(payload.response_format.type).toBe("json_schema");
    expect(payload.response_format.json_schema.strict).toBe(true);
  });
});

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
      max_results: 10,
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
});

describe("Oxylabs request builders", () => {
  test("expands X search coverage for discovery", () => {
    expect(buildOxylabsDiscoveryUrls({
      niche: "founding engineers",
      seedHandle: "austinxwalker",
      limit: 25,
      minFollowers: 1000,
    })).toEqual([
      "https://x.com/search?q=founding%20engineers&src=typed_query&f=user",
      "https://x.com/search?q=founding%20engineers&src=typed_query&f=live",
      "https://x.com/search?q=founding%20engineers&src=typed_query&f=top",
      "https://x.com/search?q=%22founding%20engineers%22&src=typed_query&f=user",
      "https://x.com/search?q=%22founding%20engineers%22&src=typed_query&f=live",
      "https://x.com/search?q=%22founding%20engineers%22&src=typed_query&f=top",
      "https://x.com/search?q=founding%20engineers%20founder&src=typed_query&f=user",
      "https://x.com/search?q=founding%20engineers%20founder&src=typed_query&f=live",
      "https://x.com/search?q=founding%20engineers%20founder&src=typed_query&f=top",
      "https://x.com/search?q=founding%20engineers%20builder&src=typed_query&f=user",
      "https://x.com/search?q=founding%20engineers%20builder&src=typed_query&f=live",
      "https://x.com/search?q=founding%20engineers%20builder&src=typed_query&f=top",
    ]);
  });
});
