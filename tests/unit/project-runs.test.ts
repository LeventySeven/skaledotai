import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let selectResults: unknown[][] = [[]];
let selectCallIndex = 0;

function chain(value: unknown): any {
  const proxy: any = new Proxy({}, {
    get(_, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve(value);
      return () => proxy;
    },
  });
  return proxy;
}

const selectMock = mock(() => {
  const result = selectResults[selectCallIndex] ?? [];
  selectCallIndex += 1;
  return chain(result);
});

mock.module("@/db", () => ({
  db: {
    select: selectMock,
  },
}));

const {
  buildProjectRunRequestKey,
  getProjectSourceProvidersByProjectIds,
} = await import("@/server/services/project-runs");

beforeEach(() => {
  selectResults = [[]];
  selectCallIndex = 0;
  selectMock.mockClear();
});

describe("project run request keys", () => {
  test("normalizes query and seed handle casing for provider task upserts", () => {
    expect(buildProjectRunRequestKey({
      projectId: "project-1",
      operationType: "search",
      requestedProvider: "multiagent",
      query: "  Founding Engineers  ",
      seedUsername: "@AustinXWalker",
    })).toBe("project-1::search::multiagent::founding engineers::austinxwalker");
  });
});

describe("project source provider aggregation", () => {
  test("collects every provider column recorded on project runs", async () => {
    selectResults = [[
      {
        projectId: "project-1",
        requestedProvider: "openrouter",
        discoveryProvider: "openrouter",
        lookupProvider: "x-api",
        networkProvider: "apify",
        tweetsProvider: "multiagent",
      },
      {
        projectId: "project-1",
        requestedProvider: "x-api",
        discoveryProvider: "x-api",
        lookupProvider: "x-api",
        networkProvider: "x-api",
        tweetsProvider: "x-api",
      },
      {
        projectId: "project-2",
        requestedProvider: "multiagent",
        discoveryProvider: "multiagent",
        lookupProvider: "apify",
        networkProvider: "not-a-provider",
        tweetsProvider: "oxylabs",
      },
    ]];

    const result = await getProjectSourceProvidersByProjectIds("user-1", ["project-1", "project-2"]);

    expect(result.get("project-1")).toEqual(["openrouter", "x-api", "apify", "multiagent"]);
    expect(result.get("project-2")).toEqual(["multiagent", "apify", "oxylabs"]);
  });
});
