import { NextRequest, NextResponse } from "next/server";
import { apify, ACTORS } from "@/lib/apify";
import { updateLead } from "@/lib/db";
import { withApiKey } from "@/lib/withApiKey";

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;

function extractEmailFromBio(bio: string): string | null {
  const match = bio.match(EMAIL_RE);
  return match ? match[0] : null;
}

async function enrichViaLinkedin(linkedinUrl: string): Promise<string | null> {
  try {
    const run = await apify.actor(ACTORS.emailEnrich).call({ linkedinUrl }, { waitSecs: 45 });
    const { items } = await apify.dataset(run.defaultDatasetId).listItems({ limit: 1 });
    const item = items[0] as Record<string, unknown> | undefined;
    if (!item?.success) return null;
    const email = String(item.email ?? "");
    return email || null;
  } catch {
    return null;
  }
}

async function handler(req: NextRequest) {
  const { leads } = await req.json();

  if (!Array.isArray(leads) || leads.length === 0) {
    return NextResponse.json({ error: "leads array is required" }, { status: 400 });
  }

  const typedLeads = leads as { id: string; linkedinUrl?: string; bio?: string }[];

  try {
    const results = await Promise.all(
      typedLeads.map(async (l) => {
        const bioEmail = l.bio ? extractEmailFromBio(l.bio) : null;
        if (bioEmail) {
          await updateLead(l.id, { email: bioEmail });
          return { id: l.id, email: bioEmail };
        }
        if (l.linkedinUrl) {
          const email = await enrichViaLinkedin(l.linkedinUrl);
          if (email) {
            await updateLead(l.id, { email });
            return { id: l.id, email };
          }
        }
        return { id: l.id, email: null };
      })
    );

    const emails: Record<string, string> = {};
    for (const r of results) if (r.email) emails[r.id] = r.email;
    return NextResponse.json({ emails });
  } catch (err) {
    console.error("[v1/leads/enrich]", err);
    return NextResponse.json({ error: "Email enrichment failed." }, { status: 500 });
  }
}

export const POST = withApiKey(handler);
