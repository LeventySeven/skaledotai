import { OutreachServiceSessionSchema } from "@/lib/validations/outreach-service";

// ── Types ────────────────────────────────────────────────────────────────────

export type DmStreamEvent =
  | { type: "progress"; batchId: string; jobId: string; leadId: string; status: "sent" | "failed"; error?: string; retryable?: boolean; index: number; total: number; sent: number; failed: number }
  | { type: "rate_limited"; batchId: string; jobId: string; leadId: string; index: number; total: number; sent: number; failed: number; queued: number; message?: string }
  | { type: "auth_expired"; batchId: string; jobId: string; leadId: string; index: number; total: number; sent: number; failed: number; message?: string }
  | { type: "complete"; batchId: string; sent: number; failed: number; total: number }
  | { type: "error"; batchId: string; message: string };

// ── Session ──────────────────────────────────────────────────────────────────

async function getOutreachServiceTarget(): Promise<{
  serviceUrl: string;
  headers: Record<string, string>;
}> {
  const response = await fetch("/api/outreach/session", {
    method: "POST",
    credentials: "include",
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(payload.error?.message ?? "Failed to connect to outreach service.");
  }

  const session = OutreachServiceSessionSchema.parse(await response.json());
  if (session.mode === "unavailable") {
    throw new Error("Outreach service is not configured. Contact support.");
  }

  return {
    serviceUrl: session.serviceUrl,
    headers: {
      authorization: `Bearer ${session.token}`,
      "content-type": "application/json",
    },
  };
}

// ── Stream ───────────────────────────────────────────────────────────────────

export async function streamDmBatch(
  batchId: string,
  onEvent: (event: DmStreamEvent) => void,
): Promise<void> {
  const { serviceUrl, headers } = await getOutreachServiceTarget();

  const response = await fetch(`${serviceUrl}/dm/send`, {
    method: "POST",
    headers,
    body: JSON.stringify({ batchId }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(payload.error?.message ?? `Outreach service error (${response.status})`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response stream from outreach service.");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // Keep the last incomplete line in the buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        try {
          onEvent(JSON.parse(trimmed) as DmStreamEvent);
        } catch {
          // Skip malformed lines
        }
      }
    }

    // Process any remaining data in buffer
    if (buffer.trim().length > 0) {
      try {
        onEvent(JSON.parse(buffer.trim()) as DmStreamEvent);
      } catch {
        // Skip malformed trailing data
      }
    }
  } finally {
    reader.releaseLock();
  }
}
