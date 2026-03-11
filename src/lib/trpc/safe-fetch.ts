type SyntheticErrorEnvelope = {
  error: {
    message: string;
    code: number;
    data: {
      code: string;
      httpStatus: number;
      path: string;
    };
  };
};

function resolveUrl(input: RequestInfo | URL): URL {
  const raw =
    input instanceof Request ? input.url
    : input instanceof URL ? input.toString()
    : String(input);

  return new URL(
    raw,
    typeof window !== "undefined" ? window.location.origin : "http://localhost",
  );
}

function getTrpcPaths(url: URL): string[] {
  const path = url.pathname.replace(/^\/api\/trpc\/?/, "") || url.pathname;
  return path.split(",").map((value) => decodeURIComponent(value)).filter(Boolean);
}

function summarizeBody(bodyText: string): string {
  const trimmed = bodyText.trim();
  if (!trimmed) return "The server returned an empty response body.";

  const preview = trimmed.replace(/\s+/g, " ").slice(0, 220);
  return `Body preview: ${preview}`;
}

export function buildSyntheticTrpcErrorBody(input: {
  url: URL;
  status: number;
  statusText?: string;
  bodyText: string;
}): SyntheticErrorEnvelope | SyntheticErrorEnvelope[] {
  const paths = getTrpcPaths(input.url);
  const httpStatus = input.status > 0 ? input.status : 500;
  const hint = httpStatus >= 504
    ? " The request likely timed out before the server could return JSON."
    : "";
  const message =
    `tRPC received a non-JSON response (${httpStatus}${input.statusText ? ` ${input.statusText}` : ""}). `
    + `${summarizeBody(input.bodyText)}${hint}`;

  const toEnvelope = (path: string): SyntheticErrorEnvelope => ({
    error: {
      message,
      code: -32603,
      data: {
        code: "INTERNAL_SERVER_ERROR",
        httpStatus,
        path,
      },
    },
  });

  if (input.url.searchParams.get("batch") === "1") {
    return paths.map((path) => toEnvelope(path));
  }

  return toEnvelope(paths[0] ?? input.url.pathname);
}

export async function safeTrpcFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  const url = resolveUrl(input);

  try {
    await response.clone().json();
    return response;
  } catch {
    const bodyText = await response.clone().text().catch(() => "");
    const body = buildSyntheticTrpcErrorBody({
      url,
      status: response.status,
      statusText: response.statusText,
      bodyText,
    });

    return new Response(JSON.stringify(body), {
      status: response.ok ? 500 : response.status || 500,
      headers: {
        "content-type": "application/json",
      },
    });
  }
}
