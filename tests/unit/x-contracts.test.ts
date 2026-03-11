import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  ensureStrictLeadImportProfiles,
  ensureStrictXProfile,
} from "@/lib/x/contracts";
import { parseJsonResponse, parseJsonText } from "@/lib/x/json";

const originalWarn = console.warn;

describe("X structured json contracts", () => {
  beforeEach(() => {
    console.warn = () => undefined;
  });

  afterEach(() => {
    console.warn = originalWarn;
  });

  test("normalizes provider profiles into strict database-safe shapes", () => {
    const profile = ensureStrictXProfile({
      xUserId: "",
      username: "@alice ",
      displayName: "",
      bio: "",
      avatarUrl: " ",
      profileUrl: "https://x.com/alice",
      followersCount: Number.NaN as never,
      followingCount: -4 as never,
    } as never);

    expect(profile).toEqual({
      xUserId: "alice",
      username: "alice",
      displayName: "alice",
      bio: "",
      profileUrl: "https://x.com/alice",
      followersCount: 0,
      followingCount: 0,
    });
  });

  test("drops profiles that cannot be coerced into the lead table contract", () => {
    const profiles = ensureStrictLeadImportProfiles([
      {
        xUserId: "u-1",
        username: "alice",
        displayName: "Alice",
        bio: "Founder",
        followersCount: 1200,
        followingCount: 300,
        source: "post_search",
      },
      {
        xUserId: "",
        username: "",
        displayName: "",
        bio: "",
        followersCount: 0,
        followingCount: 0,
      } as never,
    ], "test.provider");

    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.source).toBe("post_search");
    expect(profiles[0]?.username).toBe("alice");
  });

  test("surfaces non-json upstream bodies with a preview instead of a syntax error", () => {
    expect(() =>
      parseJsonText("<html>upstream exploded</html>", (details) => new Error(details)))
      .toThrow("Body preview: <html>upstream exploded</html>");
  });

  test("parses valid json responses without using response.json", async () => {
    const payload = await parseJsonResponse<{ leads: string[] }>(
      new Response("{\"leads\":[\"alice\"]}"),
      (details) => new Error(details),
    );

    expect(payload).toEqual({ leads: ["alice"] });
  });
});
