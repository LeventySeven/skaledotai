export function summarizeNonJsonBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "The upstream body was empty.";

  const preview = trimmed
    .replace(/\s+/g, " ")
    .slice(0, 180);

  return `Body preview: ${preview}`;
}

export function tryParseJsonText<T>(body: string): { success: true; data: T } | { success: false } {
  try {
    return {
      success: true,
      data: JSON.parse(body) as T,
    };
  } catch {
    return { success: false };
  }
}

export function parseJsonText<T>(body: string, onInvalidJson: (details: string) => Error): T {
  const parsed = tryParseJsonText<T>(body);
  if (parsed.success) return parsed.data;

  throw onInvalidJson(summarizeNonJsonBody(body));
}

export async function parseJsonResponse<T>(
  response: Response,
  onInvalidJson: (details: string) => Error,
): Promise<T> {
  return parseJsonText<T>(await response.text(), onInvalidJson);
}
