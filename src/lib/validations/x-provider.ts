import { z } from "zod";

export const XDataProviderSchema = z.enum(["x-api", "apify", "phantombuster"]);
export type XDataProvider = z.infer<typeof XDataProviderSchema>;

