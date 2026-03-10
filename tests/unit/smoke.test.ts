import { expect, test } from "bun:test";

test("bun test runs", () => {
  expect(1 + 1).toBe(2);
});

test("@/ path alias resolves", async () => {
  const { cn } = await import("@/lib/utils");
  expect(typeof cn).toBe("function");
});

test("env stubs are set", () => {
  expect(process.env.DATABASE_URL).toBeTruthy();
  expect(process.env.OPENAI_API_KEY).toBeTruthy();
});
