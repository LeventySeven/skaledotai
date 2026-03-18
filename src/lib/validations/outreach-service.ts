import { z } from "zod";

export const OutreachServiceSessionSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("unavailable"),
  }).strict(),
  z.object({
    mode: z.literal("external"),
    serviceUrl: z.string().url(),
    token: z.string().min(1),
    expiresAt: z.string().datetime(),
  }).strict(),
]);

export type OutreachServiceSession = z.infer<typeof OutreachServiceSessionSchema>;
