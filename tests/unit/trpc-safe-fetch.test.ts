import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { buildSyntheticTrpcErrorBody, safeTrpcFetch } from "@/lib/trpc/safe-fetch";

const originalFetch = globalThis.fetch;

describe("safeTrpcFetch", () => {
  beforeEach(() => {
    globalThis.fetch = mock(async () =>
      new Response("<html>Gateway Timeout</html>", {
        status: 504,
        statusText: "Gateway Timeout",
        headers: {
          "content-type": "text/html",
        },
      })) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("wraps non-json tRPC responses into a synthetic error envelope", async () => {
    const response = await safeTrpcFetch("http://localhost/api/trpc/search.run?batch=1");
    const body = await response.json() as Array<{
      error: {
        message: string;
        data: {
          path: string;
          httpStatus: number;
        };
      };
    }>;

    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body[0]?.error.data.path).toBe("search.run");
    expect(body[0]?.error.data.httpStatus).toBe(504);
    expect(body[0]?.error.message).toContain("timed out");
  });

  test("builds one envelope per batched path", () => {
    const body = buildSyntheticTrpcErrorBody({
      url: new URL("http://localhost/api/trpc/search.run,projects.analyze?batch=1"),
      status: 500,
      statusText: "Internal Server Error",
      bodyText: "plain text failure",
    }) as Array<{
      error: {
        data: {
          path: string;
        };
      };
    }>;

    expect(body).toHaveLength(2);
    expect(body.map((item) => item.error.data.path)).toEqual([
      "search.run",
      "projects.analyze",
    ]);
  });
});
