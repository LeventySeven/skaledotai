import { describe, expect, test } from "bun:test";
import {
  GenerateTemplateInputSchema,
  OutreachTemplateSchema,
  SaveOutreachTemplateInputSchema,
  UpdateOutreachTemplateInputSchema,
} from "@/lib/validations/outreach";

describe("OutreachTemplateSchema", () => {
  const VALID = {
    id: "t-1",
    title: "Collab Pitch",
    subject: "Partnership opportunity",
    body: "Hey, I'd love to work together.",
    replyRate: "24%",
  };

  test("accepts valid template", () => {
    expect(OutreachTemplateSchema.safeParse(VALID).success).toBe(true);
  });

  test("accepts template with generated flag", () => {
    expect(OutreachTemplateSchema.safeParse({ ...VALID, generated: true }).success).toBe(true);
  });

  test("rejects missing body", () => {
    const { body: _, ...without } = VALID;
    expect(OutreachTemplateSchema.safeParse(without).success).toBe(false);
  });
});

describe("GenerateTemplateInputSchema", () => {
  test("accepts empty input", () => {
    expect(GenerateTemplateInputSchema.safeParse({}).success).toBe(true);
  });

  test("accepts all fields", () => {
    const result = GenerateTemplateInputSchema.safeParse({
      projectIds: ["123e4567-e89b-12d3-a456-426614174000"],
      leadIds: ["223e4567-e89b-12d3-a456-426614174001"],
      requestedStyle: "casual",
    });
    expect(result.success).toBe(true);
  });

  test("rejects non-uuid in projectIds", () => {
    expect(GenerateTemplateInputSchema.safeParse({ projectIds: ["bad-id"] }).success).toBe(false);
  });

  test("rejects non-uuid in leadIds", () => {
    expect(GenerateTemplateInputSchema.safeParse({ leadIds: ["bad-id"] }).success).toBe(false);
  });
});

describe("SaveOutreachTemplateInputSchema", () => {
  const VALID = {
    title: "Collab Pitch",
    subject: "Partnership opportunity",
    body: "Hey, let's work together.",
    replyRate: "24%",
  };

  test("accepts valid input", () => {
    expect(SaveOutreachTemplateInputSchema.safeParse(VALID).success).toBe(true);
  });

  test("rejects empty title", () => {
    expect(SaveOutreachTemplateInputSchema.safeParse({ ...VALID, title: "" }).success).toBe(false);
  });

  test("rejects empty subject", () => {
    expect(SaveOutreachTemplateInputSchema.safeParse({ ...VALID, subject: "" }).success).toBe(false);
  });

  test("rejects empty body", () => {
    expect(SaveOutreachTemplateInputSchema.safeParse({ ...VALID, body: "" }).success).toBe(false);
  });

  test("rejects empty replyRate", () => {
    expect(SaveOutreachTemplateInputSchema.safeParse({ ...VALID, replyRate: "" }).success).toBe(false);
  });
});

describe("UpdateOutreachTemplateInputSchema", () => {
  const VALID = {
    id: "123e4567-e89b-12d3-a456-426614174000",
    title: "Updated Pitch",
    subject: "Updated subject",
    body: "Updated body.",
    replyRate: "30%",
  };

  test("accepts valid update input", () => {
    expect(UpdateOutreachTemplateInputSchema.safeParse(VALID).success).toBe(true);
  });

  test("rejects non-uuid id", () => {
    expect(UpdateOutreachTemplateInputSchema.safeParse({ ...VALID, id: "not-a-uuid" }).success).toBe(false);
  });

  test("rejects missing id", () => {
    const { id: _, ...without } = VALID;
    expect(UpdateOutreachTemplateInputSchema.safeParse(without).success).toBe(false);
  });
});
