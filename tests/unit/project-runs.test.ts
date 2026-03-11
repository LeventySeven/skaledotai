import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("@/db", () => ({
  db: {},
}));

const { buildProjectRunRequestKey } = await import("@/server/services/project-runs");

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
