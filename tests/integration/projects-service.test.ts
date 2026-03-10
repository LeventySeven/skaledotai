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
const {
  rowToPreviewLead,
  getProjectById,
  assertProject,
  createProject,
  deleteProject,
  getProjects,
  queueProjectInfluencers,
} = await import("@/server/services/projects");

// ─── shared fixtures ──────────────────────────────────────────────────────────
const NOW = new Date("2024-01-01T00:00:00.000Z");

const PROJECT_ROW = {
  id: "proj-uuid-1",
  userId: "user-1",
  name: "Web Dev Influencers",
  query: "web dev",
  seedUsername: "alice",
  createdAt: NOW,
};

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
  profileUrl: null,
  email: null,
  budget: null,
  stage: "found",
  priority: "P1",
  dmComfort: false,
  theAsk: "",
  inOutreach: false,
  discoverySource: null,
  discoveryQuery: null,
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

// ─── rowToPreviewLead ─────────────────────────────────────────────────────────
describe("rowToPreviewLead", () => {
  test("maps required fields", () => {
    const preview = rowToPreviewLead(LEAD_ROW as any);
    expect(preview.id).toBe("lead-uuid-1");
    expect(preview.name).toBe("Alice");
    expect(preview.handle).toBe("alice");
    expect(preview.followers).toBe(5000);
    expect(preview.priority).toBe("P1");
  });

  test("maps optional avatarUrl", () => {
    const preview = rowToPreviewLead(LEAD_ROW as any);
    expect(preview.avatarUrl).toBe("https://example.com/avatar.png");
  });

  test("maps null avatarUrl to undefined", () => {
    const preview = rowToPreviewLead({ ...LEAD_ROW, avatarUrl: null } as any);
    expect(preview.avatarUrl).toBeUndefined();
  });
});

// ─── getProjectById ───────────────────────────────────────────────────────────
describe("getProjectById", () => {
  test("returns Project when found", async () => {
    selectResults = [[{ project: PROJECT_ROW, leadCount: 10 }]];
    // getProjectById calls getProjects internally? No — it has its own select
    // Actually it selects from projects directly
    selectResults = [[PROJECT_ROW]];
    const project = await getProjectById("user-1", "proj-uuid-1");
    expect(project).not.toBeNull();
    expect(project!.id).toBe("proj-uuid-1");
    expect(project!.name).toBe("Web Dev Influencers");
  });

  test("returns null when not found", async () => {
    selectResults = [[]];
    const project = await getProjectById("user-1", "nonexistent");
    expect(project).toBeNull();
  });

  test("maps optional fields", async () => {
    selectResults = [[PROJECT_ROW]];
    const project = await getProjectById("user-1", "proj-uuid-1");
    expect(project!.query).toBe("web dev");
    expect(project!.seedUsername).toBe("alice");
    expect(project!.createdAt).toBe(NOW.toISOString());
  });

  test("maps null optional fields to undefined", async () => {
    selectResults = [[{ ...PROJECT_ROW, query: null, seedUsername: null }]];
    const project = await getProjectById("user-1", "proj-uuid-1");
    expect(project!.query).toBeUndefined();
    expect(project!.seedUsername).toBeUndefined();
  });
});

// ─── assertProject ────────────────────────────────────────────────────────────
describe("assertProject", () => {
  test("returns project when found", async () => {
    selectResults = [[PROJECT_ROW]];
    const project = await assertProject("user-1", "proj-uuid-1");
    expect(project.id).toBe("proj-uuid-1");
  });

  test("throws NOT_FOUND when project missing", async () => {
    selectResults = [[]];
    let err: unknown;
    try {
      await assertProject("user-1", "nonexistent");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("NOT_FOUND");
  });
});

// ─── createProject ────────────────────────────────────────────────────────────
describe("createProject", () => {
  test("inserts and returns project", async () => {
    insertReturning = [PROJECT_ROW];
    const project = await createProject("user-1", { name: "Web Dev Influencers", query: "web dev" });
    expect(project.id).toBe("proj-uuid-1");
    expect(project.name).toBe("Web Dev Influencers");
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  test("returns project without optional fields", async () => {
    insertReturning = [{ ...PROJECT_ROW, query: null, seedUsername: null }];
    const project = await createProject("user-1", { name: "Test" });
    expect(project.query).toBeUndefined();
    expect(project.seedUsername).toBeUndefined();
  });
});

// ─── deleteProject ────────────────────────────────────────────────────────────
describe("deleteProject", () => {
  test("calls delete once", async () => {
    await deleteProject("user-1", "proj-uuid-1");
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });
});

// ─── getProjects ──────────────────────────────────────────────────────────────
describe("getProjects", () => {
  test("returns empty array when no projects", async () => {
    selectResults = [[]];
    const result = await getProjects("user-1");
    expect(result).toEqual([]);
  });

  test("maps rows to projects with leadCount", async () => {
    selectResults = [[
      { project: PROJECT_ROW, leadCount: 7 },
    ]];
    const result = await getProjects("user-1");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("proj-uuid-1");
    expect(result[0].leadCount).toBe(7);
  });
});

// ─── queueProjectInfluencers ──────────────────────────────────────────────────
describe("queueProjectInfluencers", () => {
  test("returns 0 when project has no leads", async () => {
    // assertProject (select) → project found
    // select projectLeads → empty
    selectResults = [[PROJECT_ROW], []];
    const count = await queueProjectInfluencers("user-1", "proj-uuid-1");
    expect(count).toBe(0);
    expect(updateMock).not.toHaveBeenCalled();
  });

  test("returns count of updated leads", async () => {
    selectResults = [
      [PROJECT_ROW],                          // assertProject
      [{ leadId: "l-1" }, { leadId: "l-2" }], // projectLeads
    ];
    updateReturning = [{ id: "l-1" }, { id: "l-2" }];
    const count = await queueProjectInfluencers("user-1", "proj-uuid-1");
    expect(count).toBe(2);
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  test("throws NOT_FOUND when project does not exist", async () => {
    selectResults = [[]];
    let err: unknown;
    try {
      await queueProjectInfluencers("user-1", "nonexistent");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("NOT_FOUND");
  });
});
