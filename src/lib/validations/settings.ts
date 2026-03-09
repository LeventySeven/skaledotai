import { z } from "zod";

export const CreateApiKeyInputSchema = z.object({
  name: z.string().min(1),
});
export type CreateApiKeyInput = z.infer<typeof CreateApiKeyInputSchema>;

export const DeleteApiKeyInputSchema = z.object({
  id: z.string().uuid(),
});
export type DeleteApiKeyInput = z.infer<typeof DeleteApiKeyInputSchema>;
