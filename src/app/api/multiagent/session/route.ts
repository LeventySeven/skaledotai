import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { createMultiAgentServiceToken, getMultiAgentServiceUrl } from "@/lib/multiagent-service-auth";
import { MultiAgentServiceSessionSchema } from "@/lib/validations/multiagent-service";

export const runtime = "nodejs";

function jsonError(status: number, message: string): Response {
  return Response.json(
    {
      error: {
        message,
      },
    },
    { status },
  );
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return jsonError(401, "Unauthorized.");
  }

  const serviceUrl = getMultiAgentServiceUrl();
  if (!serviceUrl) {
    return Response.json(
      MultiAgentServiceSessionSchema.parse({
        mode: "local",
        streamUrl: "/api/search/live",
      }),
    );
  }

  try {
    const origin = req.headers.get("origin") ?? undefined;
    const { token, payload } = createMultiAgentServiceToken({
      userId: session.user.id,
      origin,
    });

    return Response.json(
      MultiAgentServiceSessionSchema.parse({
        mode: "external",
        streamUrl: `${serviceUrl}/search/live`,
        token,
        expiresAt: new Date(payload.exp * 1_000).toISOString(),
      }),
    );
  } catch (error) {
    return jsonError(
      500,
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : "Failed to create a multi-agent service session.",
    );
  }
}
