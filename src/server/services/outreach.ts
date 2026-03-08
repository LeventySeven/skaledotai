import "server-only";
import { listOutreachQueue } from "./leads";
import type { Lead } from "@/lib/types";

export async function getOutreachQueue(userId: string): Promise<Lead[]> {
  return listOutreachQueue(userId);
}
