import "server-only";
import { XProviderRuntimeError } from "./types";
import { parseJsonResponse } from "./json";

export function requireEnv(name: "TAVILY_API_KEY" | "AGENTQL_API_KEY" | "OPENAI_API_KEY"): string {
  const value = process.env[name];
  if (!value) {
    throw new XProviderRuntimeError({
      provider: "multiagent",
      code: "NOT_CONFIGURED",
      message: `${name} is not set.`,
      missingEnv: [name],
    });
  }
  return value;
}

export function describeUpstreamError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message.trim();
  return "Unknown upstream failure.";
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function throwNetworkFailure(
  capability: "discovery" | "lookup" | "tweets",
  upstream: "OpenAI planner" | "Tavily" | "AgentQL",
  error: unknown,
): never {
  throw new XProviderRuntimeError({
    provider: "multiagent",
    capability,
    code: "UPSTREAM_REQUEST_FAILED",
    message: `${upstream} request failed.${isAbortError(error) ? ` Timed out after waiting for the upstream response.` : ` ${describeUpstreamError(error)}`}`,
  });
}

export async function throwResponseFailure(
  capability: "discovery" | "lookup" | "tweets",
  upstream: "Tavily" | "AgentQL",
  response: Response,
): Promise<never> {
  const details = (await response.text()).trim();
  throw new XProviderRuntimeError({
    provider: "multiagent",
    capability,
    code: response.status === 429 ? "UPSTREAM_RATE_LIMITED" : "UPSTREAM_REQUEST_FAILED",
    message: `${upstream} request failed with status ${response.status}.${details ? ` ${details}` : ""}`,
  });
}

export function throwInvalidResponse(
  capability: "discovery" | "lookup" | "tweets",
  upstream: "OpenAI planner" | "Tavily" | "AgentQL",
  details?: string,
): never {
  throw new XProviderRuntimeError({
    provider: "multiagent",
    capability,
    code: "UPSTREAM_INVALID_RESPONSE",
    message: `${upstream} returned a non-JSON response.${details ? ` ${details}` : ""}`,
  });
}

export async function parseUpstreamJson(
  response: Response,
  upstream: "Tavily" | "AgentQL",
  capability: "discovery" | "lookup" | "tweets",
): Promise<unknown> {
  try {
    return await parseJsonResponse(
      response,
      (details) => new XProviderRuntimeError({
        provider: "multiagent",
        capability,
        code: "UPSTREAM_INVALID_RESPONSE",
        message: `${upstream} returned a non-JSON response. ${details}`,
      }),
    );
  } catch (error) {
    if (error instanceof XProviderRuntimeError) throw error;
    throwInvalidResponse(capability, upstream);
  }
}


export const MULTIAGENT_FETCH_TIMEOUT_MS = 12_000;
export const MULTIAGENT_SCRAPE_CONCURRENCY = 2;
