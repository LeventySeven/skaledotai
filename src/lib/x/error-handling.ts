import { TRPCError } from "@trpc/server";
import { getXDataProviderLabel } from "./provider";
import { XProviderRuntimeError } from "./types";

function normalizeMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message.trim();
  return "Unexpected X provider failure.";
}

export function toXProviderTrpcError(error: unknown): TRPCError {
  if (error instanceof TRPCError) return error;

  if (error instanceof XProviderRuntimeError) {
    const providerLabel = getXDataProviderLabel(error.provider);

    if (error.code === "NOT_CONFIGURED") {
      return new TRPCError({
        code: "BAD_REQUEST",
        message: `${providerLabel} is not configured.${error.missingEnv.length > 0 ? ` Missing configuration: ${error.missingEnv.join(", ")}.` : ""}`,
        cause: error,
      });
    }

    if (error.code === "CAPABILITY_UNSUPPORTED") {
      return new TRPCError({
        code: "BAD_REQUEST",
        message: `${providerLabel} does not support this operation directly. ${error.message}`,
        cause: error,
      });
    }

    if (error.code === "UPSTREAM_RATE_LIMITED") {
      return new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `${providerLabel} is rate-limiting requests right now. ${error.message}`,
        cause: error,
      });
    }

    return new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `${providerLabel} failed upstream. ${error.message}`,
      cause: error,
    });
  }

  if (error instanceof Error && /NetworkError|fetch failed|Failed to fetch|attempting to fetch resource/i.test(error.message)) {
    return new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Upstream provider request failed. ${error.message}`,
      cause: error,
    });
  }

  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: normalizeMessage(error),
    cause: error instanceof Error ? error : undefined,
  });
}
