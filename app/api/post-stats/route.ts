import { NextRequest, NextResponse } from "next/server";
import { runActor, ACTORS } from "@/lib/apify";
import { getPostStats, upsertPostStats, updateLead } from "@/lib/db";

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const leadId = searchParams.get("leadId");
  if (!leadId) return NextResponse.json({ error: "leadId required" }, { status: 400 });
  try {
    const stats = await getPostStats(leadId);
    return NextResponse.json(stats ?? null);
  } catch (err) {
    return NextResponse.json({ error: "Failed to fetch stats." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { leadId, handle, bio, niche } = await req.json() as {
    leadId: string;
    handle: string;
    bio: string;
    niche?: string;
  };
  if (!leadId || !handle) return NextResponse.json({ error: "leadId and handle required" }, { status: 400 });

  try {
    const username = handle.replace(/^@/, "");

    // Scrape last 30 tweets
    const tweets = await runActor<Record<string, unknown>>(ACTORS.twitterSearch, {
      searchTerms: [`from:${username}`],
      maxItems: 30,
      queryType: "Latest",
    }, 60);

    if (!tweets.length) {
      return NextResponse.json({ error: "No tweets found for this user." }, { status: 404 });
    }

    // Calculate stats
    const posts = tweets.filter((t) => {
      const author = t.author as Record<string, unknown> | undefined;
      return author && String(author.userName ?? "").toLowerCase() === username.toLowerCase();
    });

    const validPosts = posts.length > 0 ? posts : tweets;
    const count = validPosts.length;

    const avg = (field: string) => {
      const vals = validPosts.map((t) => Number(t[field] ?? 0)).filter((v) => !isNaN(v));
      return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
    };

    const avgViews = avg("viewCount");
    const avgLikes = avg("likeCount");
    const avgReplies = avg("replyCount");
    const avgRetweets = avg("retweetCount");

    // Extract top topics from tweet text
    const texts = validPosts.map((t) => String(t.text ?? t.fullText ?? "")).join("\n").slice(0, 3000);

    // AI priority scoring (optional — skips gracefully if no key)
    let priority: "P0" | "P1" = "P1";
    let topTopics: string[] = [];

    if (ANTHROPIC_KEY) {
      const prompt = niche
        ? `You are analyzing a Twitter influencer for a creator outreach campaign. The niche/topic we care about is: "${niche}".

Profile bio: ${bio}

Their recent tweet texts:
${texts}

Post engagement stats: ${avgViews} avg views, ${avgLikes} avg likes, ${avgReplies} avg replies.

Tasks:
1. List up to 5 main topics they post about (short labels, e.g. "AI tools", "startup advice")
2. Rate them as P0 (high priority — strong fit with our niche AND good engagement) or P1 (lower priority)

Respond with JSON only, no markdown:
{"topics": ["...", "..."], "priority": "P0" or "P1"}`
        : `Analyze this Twitter influencer's recent posts and extract up to 5 main topics they post about.

Bio: ${bio}

Recent tweets:
${texts}

Respond with JSON only: {"topics": ["...", "..."], "priority": "P1"}`;

      try {
        const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": ANTHROPIC_KEY,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 256,
            messages: [{ role: "user", content: prompt }],
          }),
        });
        const aiData = await aiRes.json() as { content?: { text?: string }[] };
        const raw = aiData.content?.[0]?.text ?? "";
        const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim()) as { topics?: string[]; priority?: string };
        topTopics = parsed.topics ?? [];
        if (parsed.priority === "P0") priority = "P0";
      } catch {
        // AI failed silently — stats still saved
      }
    }

    // Save stats
    const stats = await upsertPostStats({
      leadId,
      postCount: count,
      avgViews,
      avgLikes,
      avgReplies,
      avgRetweets,
      topTopics,
    });

    // Auto-apply AI priority
    if (ANTHROPIC_KEY) {
      await updateLead(leadId, { priority });
    }

    return NextResponse.json({ stats, priority });
  } catch (err) {
    console.error("[post-stats]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch post stats." },
      { status: 500 },
    );
  }
}
