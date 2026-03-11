import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { searchUsers } = await import("@/lib/x/api");

function buildUser(id: string) {
  return {
    id,
    name: `User ${id}`,
    username: `user_${id}`,
    description: "Builder",
    public_metrics: {
      followers_count: 1_500,
      following_count: 120,
      tweet_count: 25,
      listed_count: 2,
    },
  };
}

const fetchMock = mock(async (_input?: unknown) => new Response());

describe("X API user search", () => {
  beforeEach(() => {
    process.env.X_API_BEARER_TOKEN = "test-token";
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    delete process.env.X_API_BEARER_TOKEN;
  });

  test("uses the documented query parameter and paginates with next_token", async () => {
    const requestedUrls: URL[] = [];

    fetchMock.mockImplementation(async (input?: unknown) => {
      const url = new URL(String(input));
      requestedUrls.push(url);

      const nextToken = url.searchParams.get("next_token");
      const data = nextToken
        ? Array.from({ length: 20 }, (_, index) => buildUser(`page2-${index + 1}`))
        : Array.from({ length: 100 }, (_, index) => buildUser(`page1-${index + 1}`));

      return new Response(JSON.stringify({
        data,
        meta: nextToken ? {} : { next_token: "page-2" },
      }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    });

    const profiles = await searchUsers("founding engineers", 120);

    expect(profiles).toHaveLength(120);
    expect(requestedUrls).toHaveLength(2);
    expect(requestedUrls[0]?.searchParams.get("query")).toBe("founding engineers");
    expect(requestedUrls[0]?.searchParams.get("q")).toBeNull();
    expect(requestedUrls[0]?.searchParams.get("max_results")).toBe("100");
    expect(requestedUrls[1]?.searchParams.get("next_token")).toBe("page-2");
    expect(requestedUrls[1]?.searchParams.get("max_results")).toBe("20");
  });
});
