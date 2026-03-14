import { describe, expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import { toXProviderTrpcError } from "@/lib/x/error-handling";
import { XProviderRuntimeError } from "@/lib/x";

describe("X provider error handling", () => {
  test("maps unsupported capability errors to BAD_REQUEST", () => {
    const error = toXProviderTrpcError(new XProviderRuntimeError({
      provider: "multiagent",
      capability: "network",
      code: "CAPABILITY_UNSUPPORTED",
      message: "Multi-Agent does not support network operations directly.",
    }));

    expect(error).toBeInstanceOf(TRPCError);
    expect(error.code).toBe("BAD_REQUEST");
    expect(error.message).toContain("does not support this operation directly");
  });

  test("maps upstream provider failures to INTERNAL_SERVER_ERROR", () => {
    const error = toXProviderTrpcError(new XProviderRuntimeError({
      provider: "multiagent",
      capability: "discovery",
      code: "UPSTREAM_REQUEST_FAILED",
      message: "Tavily request failed with status 500.",
    }));

    expect(error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(error.message).toContain("Multi-Agent failed upstream");
    expect(error.message).toContain("Tavily request failed");
  });

  test("maps generic fetch failures to an upstream request message", () => {
    const error = toXProviderTrpcError(new Error("NetworkError when attempting to fetch resource."));

    expect(error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(error.message).toContain("Upstream provider request failed");
  });
});
