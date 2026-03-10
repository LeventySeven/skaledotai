import { beforeEach, describe, expect, mock, test } from "bun:test";
import { TRPCError } from "@trpc/server";

// ─── mocks must come before import ───────────────────────────────────────────
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
  selectCallIndex++;
  return chain(result);
});

mock.module("@/db", () => ({
  db: { select: selectMock, insert: mock(() => chain([])), update: mock(() => chain([])), delete: mock(() => chain([])) },
}));

// mock OpenAI so buildAiOutreachTemplate doesn't make real API calls
const generateTemplateMock = mock(async () => ({
  title: "AI Template",
  subject: "Let's collaborate",
  body: "Hi {{name}}, ...",
  replyRate: "~30%",
}));
mock.module("@/lib/openai", () => ({
  generateOutreachTemplate: generateTemplateMock,
  rankProfilesForQuery: mock(async () => []),
  extractTopicsAndPriority: mock(async () => ({ topics: [], priority: "P1" })),
}));

// ─── import after mocks ───────────────────────────────────────────────────────
const { getStandardOutreachTemplates, buildAiOutreachTemplate } =
  await import("@/server/services/outreach");

// ─── fixtures ─────────────────────────────────────────────────────────────────
const NOW = new Date("2024-01-01T00:00:00.000Z");

const PROJECT_ROW = {
  id: "proj-uuid-1",
  userId: "user-1",
  name: "Web Dev",
  query: "web dev",
  seedUsername: null,
  createdAt: NOW,
};

const LEAD_ROW = {
  id: "lead-uuid-1",
  userId: "user-1",
  xUserId: null,
  name: "Alice",
  handle: "alice",
  bio: "Developer",
  platform: "twitter",
  followers: 5000,
  following: null,
  avatarUrl: null,
  profileUrl: null,
  email: null,
  budget: null,
  stage: "found",
  priority: "P1",
  dmComfort: false,
  theAsk: "",
  inOutreach: true,
  discoverySource: null,
  discoveryQuery: null,
  createdAt: NOW,
  updatedAt: NOW,
};

beforeEach(() => {
  selectResults = [[]];
  selectCallIndex = 0;
  selectMock.mockClear();
  generateTemplateMock.mockClear();
});

// ─── getStandardOutreachTemplates ─────────────────────────────────────────────
describe("getStandardOutreachTemplates", () => {
  test("returns 4 templates", () => {
    const templates = getStandardOutreachTemplates();
    expect(templates).toHaveLength(4);
  });

  test("each template has required shape", () => {
    const templates = getStandardOutreachTemplates();
    for (const t of templates) {
      expect(typeof t.id).toBe("string");
      expect(typeof t.title).toBe("string");
      expect(typeof t.subject).toBe("string");
      expect(typeof t.body).toBe("string");
      expect(typeof t.replyRate).toBe("string");
      expect(t.generated).toBe(false);
    }
  });

  test("ids are stable and unique", () => {
    const templates = getStandardOutreachTemplates();
    const ids = templates.map((t) => t.id);
    expect(new Set(ids).size).toBe(4);
    expect(ids).toEqual(["standard-1", "standard-2", "standard-3", "standard-4"]);
  });

  test("body contains {{name}} placeholder", () => {
    const templates = getStandardOutreachTemplates();
    for (const t of templates) {
      expect(t.body).toContain("{{name}}");
    }
  });
});

// ─── buildAiOutreachTemplate ──────────────────────────────────────────────────
describe("buildAiOutreachTemplate", () => {
  test("throws NOT_FOUND when no leads found", async () => {
    selectResults = [[]]; // empty leads query
    let err: unknown;
    try {
      await buildAiOutreachTemplate({ userId: "user-1" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("NOT_FOUND");
  });

  test("throws NOT_FOUND when projectId provided but project not owned", async () => {
    // projects select returns fewer rows than requested projectIds
    selectResults = [[]]; // 0 owned projects found for 1 requested
    let err: unknown;
    try {
      await buildAiOutreachTemplate({
        userId: "user-1",
        projectIds: ["proj-uuid-1"],
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("NOT_FOUND");
  });

  test("calls generateOutreachTemplate with leads and returns result", async () => {
    selectResults = [
      // leads query with joins
      [{ lead: LEAD_ROW, stats: null, projectName: null }],
    ];
    const result = await buildAiOutreachTemplate({ userId: "user-1" });
    expect(generateTemplateMock).toHaveBeenCalledTimes(1);
    expect(result.title).toBe("AI Template");
    expect(result.subject).toBe("Let's collaborate");
  });

  test("passes requestedStyle to generator", async () => {
    selectResults = [[{ lead: LEAD_ROW, stats: null, projectName: null }]];
    await buildAiOutreachTemplate({ userId: "user-1", requestedStyle: "casual" });
    const callArgs = generateTemplateMock.mock.calls[0][0] as any;
    expect(callArgs.requestedStyle).toBe("casual");
  });
});
