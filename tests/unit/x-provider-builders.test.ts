import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { buildApifyAdvancedSearchInput, buildApifyUserScraperInput } = await import("@/lib/x/apify");
const { buildOpenRouterDiscoveryRequest } = await import("@/lib/x/openrouter");
const { buildTavilySearchRequest, buildAgentQlQueryRequest } = await import("@/lib/x/multiagent");

describe("Apify payload builders", () => {
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
      plugins: Array<{ id: string; engine: string }>;
      response_format: { type: string; json_schema: { strict: boolean } };
    };

    expect(payload.plugins[0]?.id).toBe("web");
    expect(payload.plugins[0]?.engine).toBe("native");
    expect(payload.response_format.type).toBe("json_schema");
    expect(payload.response_format.json_schema.strict).toBe(true);
  });
});

describe("Multi-agent request builders", () => {
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
    };

    expect(payload.url).toBe("https://x.com/austinxwalker");
    expect(payload.query).toContain("query XProfileData");
    expect(payload.query).toContain("tweets(limit: 12)");
  });
});
