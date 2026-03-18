import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const TOKEN_HEADER = {
  alg: "HS256",
  typ: "JWT",
} as const;

const TOKEN_SCHEMA = z.object({
  sub: z.string().min(1),
  iss: z.literal("skaledotai-web"),
  aud: z.literal("skaledotai-outreach-service"),
  exp: z.number().int().positive(),
  origin: z.string().min(1).optional(),
}).strict();

export type OutreachServiceTokenPayload = z.infer<typeof TOKEN_SCHEMA>;

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
  const secret = process.env.OUTREACH_SERVICE_SHARED_SECRET?.trim();
  if (!secret) {
    throw new Error("Missing required environment variable: OUTREACH_SERVICE_SHARED_SECRET");
  }
  return secret;
}

export function getOutreachServiceUrl(): string | null {
  const rawUrl = process.env.OUTREACH_SERVICE_URL?.trim();
  if (!rawUrl) return null;
  const normalized = new URL(rawUrl);
  return normalized.toString().replace(/\/$/, "");
}

export function createOutreachServiceToken(input: {
  userId: string;
  origin?: string;
  expiresInSeconds?: number;
}): { token: string; payload: OutreachServiceTokenPayload } {
  const secret = getRequiredSharedSecret();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = TOKEN_SCHEMA.parse({
    sub: input.userId,
    iss: "skaledotai-web",
    aud: "skaledotai-outreach-service",
    exp: nowSeconds + (input.expiresInSeconds ?? 60 * 60),
    origin: input.origin?.trim() || undefined,
  });
  const header = encodeBase64Url(JSON.stringify(TOKEN_HEADER));
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const unsignedToken = `${header}.${encodedPayload}`;
  const signature = signToken(unsignedToken, secret);

  return {
    token: `${unsignedToken}.${signature}`,
    payload,
  };
}

export function verifyOutreachServiceToken(token: string): OutreachServiceTokenPayload {
  const secret = getRequiredSharedSecret();
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid outreach service token.");
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
    throw new Error("Invalid outreach service token signature.");
  }

  const payload = TOKEN_SCHEMA.parse(
    JSON.parse(decodeBase64Url(encodedPayload)),
  );

  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error("Outreach service token has expired.");
  }

  return payload;
}

export function parseAllowedOutreachOrigins(): string[] {
  return (process.env.OUTREACH_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function isAllowedOutreachOrigin(origin: string | null | undefined): boolean {
  if (!origin) return true;
  const allowedOrigins = parseAllowedOutreachOrigins();
  if (allowedOrigins.length === 0) return true;
  if (allowedOrigins.includes("*")) return true;
  return allowedOrigins.includes(origin);
}
