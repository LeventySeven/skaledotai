import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const MULTIAGENT_SERVICE_TOKEN_HEADER = {
  alg: "HS256",
  typ: "JWT",
} as const;

const MULTIAGENT_SERVICE_TOKEN_SCHEMA = z.object({
  sub: z.string().min(1),
  iss: z.literal("skaledotai-web"),
  aud: z.literal("skaledotai-multiagent-service"),
  provider: z.literal("multiagent"),
  exp: z.number().int().positive(),
  origin: z.string().min(1).optional(),
}).strict();

export type MultiAgentServiceTokenPayload = z.infer<typeof MULTIAGENT_SERVICE_TOKEN_SCHEMA>;

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signToken(unsignedToken: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(unsignedToken)
    .digest("base64url");
}

function getRequiredSharedSecret(): string {
  const secret = process.env.MULTIAGENT_SERVICE_SHARED_SECRET?.trim();
  if (!secret) {
    throw new Error("Missing required environment variable: MULTIAGENT_SERVICE_SHARED_SECRET");
  }

  return secret;
}

export function getMultiAgentServiceUrl(): string | null {
  const rawUrl = process.env.MULTIAGENT_SERVICE_URL?.trim();
  if (!rawUrl) return null;

  const normalized = new URL(rawUrl);
  return normalized.toString().replace(/\/$/, "");
}

export function createMultiAgentServiceToken(input: {
  userId: string;
  origin?: string;
  expiresInSeconds?: number;
}): { token: string; payload: MultiAgentServiceTokenPayload } {
  const secret = getRequiredSharedSecret();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = MULTIAGENT_SERVICE_TOKEN_SCHEMA.parse({
    sub: input.userId,
    iss: "skaledotai-web",
    aud: "skaledotai-multiagent-service",
    provider: "multiagent",
    exp: nowSeconds + (input.expiresInSeconds ?? 60 * 30),
    origin: input.origin?.trim() || undefined,
  });
  const header = encodeBase64Url(JSON.stringify(MULTIAGENT_SERVICE_TOKEN_HEADER));
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const unsignedToken = `${header}.${encodedPayload}`;
  const signature = signToken(unsignedToken, secret);

  return {
    token: `${unsignedToken}.${signature}`,
    payload,
  };
}

export function verifyMultiAgentServiceToken(token: string): MultiAgentServiceTokenPayload {
  const secret = getRequiredSharedSecret();
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid multi-agent service token.");
  }

  const [header, encodedPayload, signature] = parts;
  const unsignedToken = `${header}.${encodedPayload}`;
  const expectedSignature = signToken(unsignedToken, secret);
  const providedBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");

  if (
    providedBuffer.length !== expectedBuffer.length
    || !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw new Error("Invalid multi-agent service token signature.");
  }

  const payload = MULTIAGENT_SERVICE_TOKEN_SCHEMA.parse(
    JSON.parse(decodeBase64Url(encodedPayload)),
  );

  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error("Multi-agent service token has expired.");
  }

  return payload;
}

export function parseAllowedMultiAgentOrigins(): string[] {
  return (process.env.MULTIAGENT_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function isAllowedMultiAgentOrigin(origin: string | null | undefined): boolean {
  if (!origin) return true;

  const allowedOrigins = parseAllowedMultiAgentOrigins();
  if (allowedOrigins.length === 0) return true;
  if (allowedOrigins.includes("*")) return true;

  return allowedOrigins.includes(origin);
}
