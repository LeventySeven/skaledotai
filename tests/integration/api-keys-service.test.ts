import { beforeEach, describe, expect, mock, test } from "bun:test";
import { TRPCError } from "@trpc/server";

// ─── mocks must come before import ───────────────────────────────────────────
mock.module("server-only", () => ({}));

let selectResults: unknown[][] = [[]];
let selectCallIndex = 0;
let deleteReturning: unknown[] = [];

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
  selectCallIndex++;
  return chain(result);
});
const deleteMock = mock(() => chain(deleteReturning));
// insert returns void for createApiKey (no .returning())
const insertMock = mock(() => chain(undefined));

mock.module("@/db", () => ({
  db: { select: selectMock, delete: deleteMock, insert: insertMock },
}));

// ─── import after mocks ───────────────────────────────────────────────────────
const { listApiKeys, createApiKey, deleteApiKey } = await import("@/server/services/api-keys");

// ─── fixtures ─────────────────────────────────────────────────────────────────
const NOW = new Date("2024-01-01T00:00:00.000Z");

const KEY_ROW = {
  id: "key-uuid-1",
  name: "My Key",
  prefix: "sk_1234567",
  createdAt: NOW,
  lastUsed: null,
};

beforeEach(() => {
  selectResults = [[]];
  selectCallIndex = 0;
  deleteReturning = [];
  selectMock.mockClear();
  deleteMock.mockClear();
  insertMock.mockClear();
});

// ─── listApiKeys ──────────────────────────────────────────────────────────────
describe("listApiKeys", () => {
  test("returns empty array when user has no keys", async () => {
    selectResults = [[]];
    const result = await listApiKeys("user-1");
    expect(result).toEqual([]);
  });

  test("returns key rows from db", async () => {
    selectResults = [[KEY_ROW]];
    const result = await listApiKeys("user-1");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("key-uuid-1");
    expect(result[0].name).toBe("My Key");
    expect(result[0].prefix).toBe("sk_1234567");
  });
});

// ─── createApiKey ─────────────────────────────────────────────────────────────
describe("createApiKey", () => {
  test("returns a key with sk_ prefix", async () => {
    const result = await createApiKey("user-1", "My Key");
    expect(result.key).toMatch(/^sk_[0-9a-f]+$/);
    expect(result.name).toBe("My Key");
  });

  test("prefix is first 10 chars of the raw key", async () => {
    const result = await createApiKey("user-1", "My Key");
    expect(result.prefix).toBe(result.key.slice(0, 10));
  });

  test("each call generates a unique key", async () => {
    const a = await createApiKey("user-1", "Key A");
    const b = await createApiKey("user-1", "Key B");
    expect(a.key).not.toBe(b.key);
  });

  test("calls insert once", async () => {
    await createApiKey("user-1", "My Key");
    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});

// ─── deleteApiKey ─────────────────────────────────────────────────────────────
describe("deleteApiKey", () => {
  test("resolves without error when key deleted", async () => {
    deleteReturning = [{ id: "key-uuid-1" }];
    await expect(deleteApiKey("user-1", "key-uuid-1")).resolves.toBeUndefined();
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  test("throws NOT_FOUND when key does not exist", async () => {
    deleteReturning = [];
    let err: unknown;
    try {
      await deleteApiKey("user-1", "nonexistent");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("NOT_FOUND");
  });
});
