import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;

export async function POST() {
  let updated = 0;
  let offset = 0;
  const batchSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from("leads")
      .select("id, bio")
      .is("email", null)
      .not("bio", "is", null)
      .neq("bio", "")
      .range(offset, offset + batchSize - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    const hits = (data as { id: string; bio: string }[])
      .map((row) => ({ id: row.id, email: row.bio.match(EMAIL_RE)?.[0] ?? null }))
      .filter((r): r is { id: string; email: string } => r.email !== null);

    if (hits.length > 0) {
      await Promise.all(
        hits.map((h) =>
          supabase
            .from("leads")
            .update({ email: h.email, updated_at: new Date().toISOString() })
            .eq("id", h.id)
        )
      );
      updated += hits.length;
    }

    if (data.length < batchSize) break;
    offset += batchSize;
  }

  return NextResponse.json({ updated });
}
