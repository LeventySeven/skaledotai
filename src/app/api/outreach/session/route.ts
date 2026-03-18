import { createOutreachServiceToken, getOutreachServiceUrl } from "@/lib/outreach-service-auth";
import { OutreachServiceSessionSchema } from "@/lib/validations/outreach-service";
import { getRequestSession } from "@/lib/auth-session";

export const runtime = "nodejs";

function jsonError(status: number, message: string): Response {
  return Response.json({ error: { message } }, { status });
}

export async function POST(req: Request): Promise<Response> {
  const session = await getRequestSession();
  if (!session?.user?.id) {
    return jsonError(401, "Unauthorized.");
  }

  const serviceUrl = getOutreachServiceUrl();
  if (!serviceUrl) {
    return Response.json(
      OutreachServiceSessionSchema.parse({ mode: "unavailable" }),
    );
  }

  try {
    const origin = req.headers.get("origin") ?? undefined;
    const { token, payload } = createOutreachServiceToken({
      userId: session.user.id,
      origin,
    });

    return Response.json(
      OutreachServiceSessionSchema.parse({
        mode: "external",
        serviceUrl,
        token,
        expiresAt: new Date(payload.exp * 1_000).toISOString(),
      }),
    );
  } catch (error) {
    return jsonError(
      500,
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : "Failed to create an outreach service session.",
    );
  }
}
