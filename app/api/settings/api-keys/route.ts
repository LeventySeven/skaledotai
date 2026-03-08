import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { generateApiKey } from "@/lib/apikey";

export async function GET() {
  const { data, error } = await supabase
    .from("api_keys")
    .select("id, name, prefix, created_at, last_used")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const keys = (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    createdAt: r.created_at,
    lastUsed: r.last_used ?? null,
  }));

  return NextResponse.json(keys);
}

export async function POST(req: NextRequest) {
  const { name } = await req.json();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const { raw, hash, prefix } = generateApiKey();

  const { data, error } = await supabase
    .from("api_keys")
    .insert({ name, key_hash: hash, prefix })
    .select("id, name, prefix, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ id: data.id, name: data.name, prefix: data.prefix, createdAt: data.created_at, raw });
}
