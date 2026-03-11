import { describe, expect, mock, test } from "bun:test";

mock.module("@trpc/server/adapters/fetch", () => ({
  fetchRequestHandler() {
    throw new Error("agentql blew up");
  },
}));

mock.module("@/server/trpc/root", () => ({
  appRouter: {},
}));

mock.module("@/server/trpc/context", () => ({
  createContext: async () => ({ xDataProvider: "x-api" }),
}));

const { GET } = await import("@/app/api/trpc/[trpc]/route");

describe("tRPC route fatal fallback", () => {
  test("returns json when the adapter throws before tRPC serializes the error", async () => {
    const response = await GET(new Request("http://localhost/api/trpc/search.run"));
    const body = await response.json() as {
      error: {
        message: string;
        data: {
          code: string;
          path: string;
        };
      };
    };

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body.error.message).toBe("agentql blew up");
    expect(body.error.data.code).toBe("INTERNAL_SERVER_ERROR");
    expect(body.error.data.path).toBe("search.run");
  });
});
