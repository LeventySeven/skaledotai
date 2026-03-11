import { describe, expect, test } from "bun:test";

const { toPhantomBusterRuntimeError } = await import("@/lib/x/phantombuster");

describe("PhantomBuster error mapping", () => {
  test("explains that automation URLs are not valid workspace agent IDs", () => {
    const error = toPhantomBusterRuntimeError(
      '(400): {"status":"error","error":"Agent not found"}',
      "PHANTOMBUSTER_TWITTER_SEARCH_EXPORT_ID",
      "7263448483654601",
    );

    expect(error.message).toContain("/phantoms/{id}");
    expect(error.message).toContain("/automations/...");
    expect(error.message).toContain("PHANTOMBUSTER_TWITTER_SEARCH_EXPORT_ID");
  });
});
