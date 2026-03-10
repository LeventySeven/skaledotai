import { describe, expect, test } from "bun:test";
import { CreateApiKeyInputSchema, DeleteApiKeyInputSchema } from "@/lib/validations/settings";

describe("CreateApiKeyInputSchema", () => {
  test("accepts valid name", () => {
    expect(CreateApiKeyInputSchema.safeParse({ name: "My Key" }).success).toBe(true);
  });

  test("rejects empty name", () => {
    expect(CreateApiKeyInputSchema.safeParse({ name: "" }).success).toBe(false);
  });

  test("rejects missing name", () => {
    expect(CreateApiKeyInputSchema.safeParse({}).success).toBe(false);
  });
});

describe("DeleteApiKeyInputSchema", () => {
  test("accepts valid uuid", () => {
    const result = DeleteApiKeyInputSchema.safeParse({
      id: "123e4567-e89b-12d3-a456-426614174000",
    });
    expect(result.success).toBe(true);
  });

  test("rejects non-uuid id", () => {
    expect(DeleteApiKeyInputSchema.safeParse({ id: "not-a-uuid" }).success).toBe(false);
  });

  test("rejects missing id", () => {
    expect(DeleteApiKeyInputSchema.safeParse({}).success).toBe(false);
  });
});
