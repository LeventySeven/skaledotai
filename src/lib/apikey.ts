import { createHash, randomBytes } from "crypto";
import { supabase } from "@/lib/supabase";

export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = "sk_" + randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(raw).digest("hex");
  const prefix = raw.slice(0, 10);
  return { raw, hash, prefix };
}

export async function validateApiKey(raw: string): Promise<boolean> {
  const hash = createHash("sha256").update(raw).digest("hex");
  const { data, error } = await supabase
    .from("api_keys")
    .select("id")
    .eq("key_hash", hash)
    .single();

  if (error || !data) return false;

  // Update last_used in background (don't await)
  supabase
    .from("api_keys")
    .update({ last_used: new Date().toISOString() })
    .eq("id", data.id)
    .then(() => {});

  return true;
}
