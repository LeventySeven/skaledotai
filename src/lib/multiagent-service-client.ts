import type { ProjectRunTraceStep } from "@/lib/validations/project-runs";
import { MultiAgentServiceSessionSchema } from "@/lib/validations/multiagent-service";
import type { XDataProvider } from "@/lib/x";

export function mergeTraceSteps(
  current: ProjectRunTraceStep[],
  incoming: ProjectRunTraceStep[],
): ProjectRunTraceStep[] {
  if (current.length === 0) return incoming;
  if (incoming.length === 0) return current;

  const merged = new Map<string, ProjectRunTraceStep>();

  for (const step of current) {
    merged.set(step.id, step);
  }
  for (const step of incoming) {
    merged.set(step.id, step);
  }

  const ordered = [...current];
  for (const step of incoming) {
    if (current.some((existing) => existing.id === step.id)) continue;
    ordered.push(step);
  }

  return ordered.map((step) => merged.get(step.id) ?? step);
}

export async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { error?: { message?: string } };
    if (payload.error?.message) return payload.error.message;
  } catch {
    // Fall back to text parsing below.
  }

  const text = await response.text().catch(() => "");
  return text.trim() || "Live search failed.";
}

export function normalizeLiveStreamError(error: unknown): Error {
  if (error instanceof Error && error.message.trim().length > 0) {
    if (/input stream/i.test(error.message)) {
      return new Error("Live search stream disconnected before the multi-agent run finished.");
    }
    return error;
  }

  return new Error("Live search stream disconnected before the multi-agent run finished.");
}

export async function getLiveMultiAgentStreamTarget(provider: XDataProvider): Promise<{
  streamUrl: string;
  headers: Record<string, string>;
}> {
  const response = await fetch("/api/multiagent/session", {
    method: "POST",
    credentials: "include",
    headers: {
      "x-data-provider": provider,
    },
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  const session = MultiAgentServiceSessionSchema.parse(await response.json());
  if (session.mode === "external") {
    return {
      streamUrl: session.streamUrl,
      headers: {
        authorization: `Bearer ${session.token}`,
        "content-type": "application/json",
      },
    };
  }

  return {
    streamUrl: session.streamUrl,
    headers: {
      "content-type": "application/json",
      "x-data-provider": provider,
    },
  };
}
