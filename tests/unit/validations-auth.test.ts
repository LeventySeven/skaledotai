import { describe, expect, test } from "bun:test";
import { LoginSchema, SignUpSchema } from "@/lib/validations/auth";

describe("SignUpSchema", () => {
  const VALID = {
    name: "Alice Smith",
    email: "alice@example.com",
    password: "hunter99",
  };

  test("accepts valid signup", () => {
    expect(SignUpSchema.safeParse(VALID).success).toBe(true);
  });

  test("accepts valid signup with callbackUrl", () => {
    const result = SignUpSchema.safeParse({ ...VALID, callbackUrl: "/dashboard" });
    expect(result.success).toBe(true);
  });

  test("rejects name shorter than 2 chars", () => {
    expect(SignUpSchema.safeParse({ ...VALID, name: "A" }).success).toBe(false);
  });

  test("rejects invalid email", () => {
    expect(SignUpSchema.safeParse({ ...VALID, email: "not-an-email" }).success).toBe(false);
    expect(SignUpSchema.safeParse({ ...VALID, email: "" }).success).toBe(false);
  });

  test("rejects password shorter than 8 chars", () => {
    expect(SignUpSchema.safeParse({ ...VALID, password: "short" }).success).toBe(false);
  });

  test("rejects non-internal callbackUrl", () => {
    expect(SignUpSchema.safeParse({ ...VALID, callbackUrl: "https://evil.com" }).success).toBe(false);
  });

  test("accepts callbackUrl with subpath", () => {
    const result = SignUpSchema.safeParse({ ...VALID, callbackUrl: "/projects/123" });
    expect(result.success).toBe(true);
  });
});

describe("LoginSchema", () => {
  const VALID = {
    email: "alice@example.com",
    password: "anypassword",
  };

  test("accepts valid login", () => {
    expect(LoginSchema.safeParse(VALID).success).toBe(true);
  });

  test("accepts login with callbackUrl", () => {
    const result = LoginSchema.safeParse({ ...VALID, callbackUrl: "/dashboard" });
    expect(result.success).toBe(true);
  });

  test("rejects invalid email", () => {
    expect(LoginSchema.safeParse({ ...VALID, email: "bad" }).success).toBe(false);
  });

  test("rejects empty password", () => {
    expect(LoginSchema.safeParse({ ...VALID, password: "" }).success).toBe(false);
  });

  test("rejects non-internal callbackUrl", () => {
    expect(LoginSchema.safeParse({ ...VALID, callbackUrl: "http://external.com" }).success).toBe(false);
  });
});
