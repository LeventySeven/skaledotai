import { z } from "zod";

export const XDataProviderSchema = z.enum([
  "x-api",
  "twitterapi",
  "apify",
  "multiagent",
  "openrouter",
]);
export type XDataProvider = z.infer<typeof XDataProviderSchema>;
