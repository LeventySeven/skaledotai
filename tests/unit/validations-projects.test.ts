import { describe, expect, test } from "bun:test";
import {
  AnalyzeProjectsInputSchema,
  CreateProjectInputSchema,
  ProjectOverviewSchema,
  ProjectSchema,
} from "@/lib/validations/projects";

describe("ProjectSchema", () => {
  test("accepts minimal project", () => {
    const result = ProjectSchema.safeParse({
      id: "p-1",
      name: "Test Project",
      createdAt: "2024-01-01T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  test("accepts project with all fields", () => {
    const result = ProjectSchema.safeParse({
      id: "p-1",
      name: "Test Project",
      query: "web dev",
      seedUsername: "alice",
      createdAt: "2024-01-01T00:00:00.000Z",
      leadCount: 42,
      sourceProviders: ["x-api", "openrouter"],
    });
    expect(result.success).toBe(true);
  });

  test("rejects missing name", () => {
    expect(ProjectSchema.safeParse({ id: "p-1", createdAt: "2024-01-01T00:00:00.000Z" }).success).toBe(false);
  });
});

describe("ProjectOverviewSchema", () => {
  test("accepts valid overview", () => {
    const result = ProjectOverviewSchema.safeParse({
      id: "p-1",
      name: "Test",
      createdAt: "2024-01-01T00:00:00.000Z",
      leadCount: 10,
      sourceProviders: ["x-api"],
      avgFollowers: 5000,
      topFollowers: 50000,
      p0LeadCount: 2,
      previewLeads: [
        {
          id: "l-1",
          name: "Alice",
          handle: "alice",
          bio: "Dev",
          followers: 1000,
          priority: "P1",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  test("accepts empty previewLeads", () => {
    const result = ProjectOverviewSchema.safeParse({
      id: "p-1",
      name: "Test",
      createdAt: "2024-01-01T00:00:00.000Z",
      leadCount: 0,
      sourceProviders: [],
      avgFollowers: 0,
      topFollowers: 0,
      p0LeadCount: 0,
      previewLeads: [],
    });
    expect(result.success).toBe(true);
  });

  test("rejects missing required metric fields", () => {
    expect(
      ProjectOverviewSchema.safeParse({
        id: "p-1",
        name: "Test",
        createdAt: "2024-01-01T00:00:00.000Z",
        // missing leadCount, avgFollowers, etc.
      }).success,
    ).toBe(false);
  });
});

describe("CreateProjectInputSchema", () => {
  test("accepts name only", () => {
    expect(CreateProjectInputSchema.safeParse({ name: "My Project" }).success).toBe(true);
  });

  test("accepts all fields", () => {
    const result = CreateProjectInputSchema.safeParse({
      name: "My Project",
      query: "web developers",
      seedUsername: "alice",
    });
    expect(result.success).toBe(true);
  });

  test("rejects empty name", () => {
    expect(CreateProjectInputSchema.safeParse({ name: "" }).success).toBe(false);
  });

  test("rejects missing name", () => {
    expect(CreateProjectInputSchema.safeParse({}).success).toBe(false);
  });
});

describe("AnalyzeProjectsInputSchema", () => {
  test("accepts single uuid", () => {
    const result = AnalyzeProjectsInputSchema.safeParse({
      projectIds: ["123e4567-e89b-12d3-a456-426614174000"],
    });
    expect(result.success).toBe(true);
  });

  test("accepts multiple uuids with optional name", () => {
    const result = AnalyzeProjectsInputSchema.safeParse({
      projectIds: [
        "123e4567-e89b-12d3-a456-426614174000",
        "223e4567-e89b-12d3-a456-426614174001",
      ],
      name: "Combined Analysis",
    });
    expect(result.success).toBe(true);
  });

  test("rejects empty projectIds array", () => {
    expect(AnalyzeProjectsInputSchema.safeParse({ projectIds: [] }).success).toBe(false);
  });

  test("rejects non-uuid in projectIds", () => {
    expect(AnalyzeProjectsInputSchema.safeParse({ projectIds: ["not-a-uuid"] }).success).toBe(false);
  });

  test("rejects missing projectIds", () => {
    expect(AnalyzeProjectsInputSchema.safeParse({}).success).toBe(false);
  });
});
