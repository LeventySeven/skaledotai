import { z } from "zod";

export const MultiAgentServiceSessionSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("local"),
    streamUrl: z.string().min(1),
  }).strict(),
  z.object({
    mode: z.literal("external"),
    streamUrl: z.string().url(),
    token: z.string().min(1),
    expiresAt: z.string().datetime(),
  }).strict(),
]);

export type MultiAgentServiceSession = z.infer<typeof MultiAgentServiceSessionSchema>;
