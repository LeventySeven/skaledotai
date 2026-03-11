import { z } from "zod";

export const XDataProviderSchema = z.enum([
  "x-api",
  "apify",
  "oxylabs",
  "multiagent",
  "openrouter",
]);
export type XDataProvider = z.infer<typeof XDataProviderSchema>;
