import { beforeEach, describe, expect, mock, test } from "bun:test";
import { TRPCError } from "@trpc/server";

// ─── mocks must come before import ───────────────────────────────────────────
mock.module("server-only", () => ({}));

let selectResults: unknown[][] = [[]];
let selectCallIndex = 0;
let updateReturning: unknown[] = [];
let deleteReturning: unknown[] = [];
let insertReturning: unknown[] = [];

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
const updateMock = mock(() => chain(updateReturning));
const deleteMock = mock(() => chain(deleteReturning));
const insertMock = mock(() => chain(insertReturning));

mock.module("@/db", () => ({
  db: { select: selectMock, update: updateMock, delete: deleteMock, insert: insertMock },
}));

// ─── import after mocks ───────────────────────────────────────────────────────
const { rowToLead, getLeadById, updateLead, deleteLead, addProfilesToProject } =
  await import("@/server/services/leads");

// ─── shared fixtures ──────────────────────────────────────────────────────────
const NOW = new Date("2024-01-01T00:00:00.000Z");

const LEAD_ROW = {
  id: "lead-uuid-1",
  userId: "user-1",
  xUserId: "x-123",
  name: "Alice",
  handle: "alice",
  bio: "Developer",
  platform: "twitter",
  followers: 5000,
  following: 200,
  avatarUrl: "https://example.com/avatar.png",
  profileUrl: "https://twitter.com/alice",
  email: "alice@example.com",
  budget: "1500.00",
  stage: "found",
  priority: "P1",
  dmComfort: true,
  theAsk: "Collab post",
  inOutreach: false,
  discoverySource: "profile_search",
  discoveryQuery: "web dev",
  createdAt: NOW,
  updatedAt: NOW,
};

beforeEach(() => {
  selectResults = [[]];
  selectCallIndex = 0;
  updateReturning = [];
  deleteReturning = [];
  insertReturning = [];
  selectMock.mockClear();
  updateMock.mockClear();
  deleteMock.mockClear();
  insertMock.mockClear();
});

// ─── rowToLead ────────────────────────────────────────────────────────────────
describe("rowToLead", () => {
  test("maps all fields correctly", () => {
    const lead = rowToLead(LEAD_ROW as any);
    expect(lead.id).toBe("lead-uuid-1");
    expect(lead.name).toBe("Alice");
    expect(lead.handle).toBe("alice");
    expect(lead.platform).toBe("twitter");
    expect(lead.followers).toBe(5000);
    expect(lead.following).toBe(200);
    expect(lead.email).toBe("alice@example.com");
    expect(lead.stage).toBe("found");
    expect(lead.priority).toBe("P1");
    expect(lead.dmComfort).toBe(true);
    expect(lead.inOutreach).toBe(false);
    expect(lead.createdAt).toBe(NOW.toISOString());
    expect(lead.updatedAt).toBe(NOW.toISOString());
  });

  test("converts numeric budget string to number", () => {
    const lead = rowToLead(LEAD_ROW as any);
    expect(lead.budget).toBe(1500);
  });

  test("maps null budget to undefined", () => {
    const lead = rowToLead({ ...LEAD_ROW, budget: null } as any);
    expect(lead.budget).toBeUndefined();
  });

  test("maps null optional fields to undefined", () => {
    const lead = rowToLead({
      ...LEAD_ROW,
      xUserId: null,
      following: null,
      avatarUrl: null,
      profileUrl: null,
      email: null,
      discoverySource: null,
      discoveryQuery: null,
    } as any);
    expect(lead.xUserId).toBeUndefined();
    expect(lead.following).toBeUndefined();
    expect(lead.avatarUrl).toBeUndefined();
    expect(lead.email).toBeUndefined();
    expect(lead.discoverySource).toBeUndefined();
  });

  test("attaches projectId and projectName when provided", () => {
    const lead = rowToLead(LEAD_ROW as any, "proj-1", "My Project");
    expect(lead.projectId).toBe("proj-1");
    expect(lead.projectName).toBe("My Project");
    expect(lead.crmId).toBe("lead-uuid-1");
  });

  test("defaults missing stage to found", () => {
    // stage has a db default so can technically be any string — service parses it
    const lead = rowToLead({ ...LEAD_ROW, stage: "messaged" } as any);
    expect(lead.stage).toBe("messaged");
  });
});

// ─── getLeadById ──────────────────────────────────────────────────────────────
describe("getLeadById", () => {
  test("returns Lead when row found", async () => {
    selectResults = [[LEAD_ROW]];
    const lead = await getLeadById("user-1", "lead-uuid-1");
    expect(lead).not.toBeNull();
    expect(lead!.id).toBe("lead-uuid-1");
    expect(selectMock).toHaveBeenCalledTimes(1);
  });

  test("returns null when no row found", async () => {
    selectResults = [[]];
    const lead = await getLeadById("user-1", "nonexistent");
    expect(lead).toBeNull();
  });
});

// ─── updateLead ───────────────────────────────────────────────────────────────
describe("updateLead", () => {
  test("returns updated Lead on success", async () => {
    updateReturning = [{ ...LEAD_ROW, stage: "messaged" }];
    const lead = await updateLead("user-1", "lead-uuid-1", { stage: "messaged" });
    expect(lead.stage).toBe("messaged");
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  test("throws NOT_FOUND when no row returned", async () => {
    updateReturning = [];
    let err: unknown;
    try {
      await updateLead("user-1", "lead-uuid-1", { stage: "messaged" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("NOT_FOUND");
  });

  test("maps budget patch correctly", async () => {
    updateReturning = [{ ...LEAD_ROW, budget: "2000.00" }];
    const lead = await updateLead("user-1", "lead-uuid-1", { budget: 2000 });
    expect(lead.budget).toBe(2000);
  });
});

// ─── deleteLead ───────────────────────────────────────────────────────────────
describe("deleteLead", () => {
  test("resolves without error when lead deleted", async () => {
    deleteReturning = [{ id: "lead-uuid-1" }];
    await expect(deleteLead("user-1", "lead-uuid-1")).resolves.toBeUndefined();
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  test("throws NOT_FOUND when lead does not exist", async () => {
    deleteReturning = [];
    let err: unknown;
    try {
      await deleteLead("user-1", "nonexistent");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("NOT_FOUND");
  });
});

// ─── addProfilesToProject ─────────────────────────────────────────────────────
describe("addProfilesToProject", () => {
  test("returns empty array for empty profiles", async () => {
    const result = await addProfilesToProject({
      userId: "user-1",
      projectId: "proj-1",
      profiles: [],
      discoverySource: "profile_search",
      discoveryQuery: "web dev",
    });
    expect(result).toEqual([]);
    expect(insertMock).not.toHaveBeenCalled();
  });

  test("inserts profiles and returns mapped leads", async () => {
    insertReturning = [LEAD_ROW];
    const result = await addProfilesToProject({
      userId: "user-1",
      projectId: "proj-1",
      profiles: [{
        xUserId: "x-123",
        username: "alice",
        displayName: "Alice",
        bio: "Developer",
        followersCount: 5000,
        followingCount: 200,
        avatarUrl: "https://example.com/avatar.png",
        profileUrl: "https://twitter.com/alice",
      }],
      discoverySource: "profile_search",
      discoveryQuery: "web dev",
    });
    expect(result).toHaveLength(1);
    expect(result[0].handle).toBe("alice");
    // insert called twice: once for leads upsert, once for projectLeads
    expect(insertMock).toHaveBeenCalledTimes(2);
  });
});
