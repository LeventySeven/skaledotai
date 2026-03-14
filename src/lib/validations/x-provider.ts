import { z } from "zod";

export const XDataProviderSchema = z.enum([
  "x-api",
  "twitterapi",
  "multiagent",
]);
export type XDataProvider = z.infer<typeof XDataProviderSchema>;
