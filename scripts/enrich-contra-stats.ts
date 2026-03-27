/**
 * Enrich contra leads with post analytics (avg views, likes, comments, reposts).
 * Uses the X API (bearer token) to fetch last ~20 tweets per lead.
 *
 * Usage: bun run scripts/enrich-contra-stats.ts
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  lookupUsersByUsernames,
  getUserTweets,
  mapTweetsToMetrics,
} from "../src/lib/x/api";

type ContraRow = {
  id: string;
  handle: string;
  name: string;
  followers: number | null;
  avg_views: number | null;
  avg_likes: number | null;
  avg_comments: number | null;
  avg_reposts: number | null;
  score: number | null;
  [key: string]: unknown;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Score formula:
 *   engagement_rate = (avg_likes + avg_comments + avg_reposts) / followers
 *   views_per_follower = avg_views / followers
 *   score = round((engagement_rate * 10000) + (views_per_follower * 100))
 *   Clamped 0–100
 */
function computeScore(
  avgViews: number,
  avgLikes: number,
  avgComments: number,
  avgReposts: number,
  followers: number,
): number {
  if (followers <= 0) return 0;
  const engagementRate = (avgLikes + avgComments + avgReposts) / followers;
  const viewsPerFollower = avgViews / followers;
  const raw = (engagementRate * 10000) + (viewsPerFollower * 100);
  return Math.min(100, Math.max(0, Math.round(raw)));
}

async function main() {
  const filepath = join(import.meta.dir, "..", "data", "exports", "contra.json");
  const leads: ContraRow[] = JSON.parse(readFileSync(filepath, "utf-8"));

  // Filter: only leads that don't have avg_views yet
  const needsEnrich = leads.filter((l) => l.avg_views == null);
  const alreadyDone = leads.length - needsEnrich.length;

  console.log(`\n  Total leads: ${leads.length}`);
  console.log(`  Already enriched: ${alreadyDone}`);
  console.log(`  Need enrichment: ${needsEnrich.length}\n`);

  if (needsEnrich.length === 0) {
    console.log("  All leads already enriched.\n");
    process.exit(0);
  }

  // Step 1: Batch-resolve usernames → userIds (100 at a time via X API)
  console.log("  Resolving usernames to user IDs...\n");
  const handles = needsEnrich.map((l) => l.handle.replace(/^@/, ""));
  const handleToUserId = new Map<string, string>();

  for (let i = 0; i < handles.length; i += 100) {
    const batch = handles.slice(i, i + 100);
    try {
      const profiles = await lookupUsersByUsernames(batch);
      for (const p of profiles) {
        if (p.xUserId && p.username) {
          handleToUserId.set(p.username.toLowerCase(), p.xUserId);
        }
      }
      console.log(`  Resolved ${Math.min(i + 100, handles.length)}/${handles.length} usernames (${profiles.length} found)`);
    } catch (err) {
      console.log(`  Error resolving batch ${i}-${i + 100}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (i + 100 < handles.length) await sleep(1000);
  }

  console.log(`\n  Resolved ${handleToUserId.size}/${handles.length} user IDs. Fetching tweets...\n`);

  // Step 2: Fetch tweets for each lead
  let enriched = 0;
  let failed = 0;
  let inactive = 0;

  for (let i = 0; i < needsEnrich.length; i++) {
    const lead = needsEnrich[i];
    const handle = lead.handle.replace(/^@/, "").toLowerCase();
    const userId = handleToUserId.get(handle);

    process.stdout.write(`  [${i + 1}/${needsEnrich.length}] @${lead.handle}...`);

    if (!userId) {
      console.log(" user not found on X");
      lead.avg_views = 0;
      lead.avg_likes = 0;
      lead.avg_comments = 0;
      lead.avg_reposts = 0;
      lead.score = 0;
      failed++;
      continue;
    }

    try {
      const rawTweets = await getUserTweets(userId, 20);
      const metrics = mapTweetsToMetrics(rawTweets);

      if (metrics.length === 0) {
        console.log(" no tweets");
        lead.avg_views = 0;
        lead.avg_likes = 0;
        lead.avg_comments = 0;
        lead.avg_reposts = 0;
        lead.score = 0;
        inactive++;
        continue;
      }

      // Check activity: X API returns tweets in reverse chronological order.
      // The created_at field is on the raw tweet, not the metrics.
      const mostRecentDate = rawTweets[0]?.created_at;
      if (mostRecentDate) {
        const oneMonthAgo = new Date();
        oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
        if (new Date(mostRecentDate) < oneMonthAgo) {
          console.log(` inactive (last: ${mostRecentDate.slice(0, 10)})`);
          lead.avg_views = 0;
          lead.avg_likes = 0;
          lead.avg_comments = 0;
          lead.avg_reposts = 0;
          lead.score = 0;
          inactive++;
          enriched++;

          if ((enriched + failed) % 10 === 0) {
            writeFileSync(filepath, JSON.stringify(leads, null, 2));
          }
          continue;
        }
      }

      const totalViews = metrics.reduce((s, m) => s + m.viewCount, 0);
      const totalLikes = metrics.reduce((s, m) => s + m.likeCount, 0);
      const totalReplies = metrics.reduce((s, m) => s + m.replyCount, 0);
      const totalReposts = metrics.reduce((s, m) => s + m.repostCount, 0);

      const avgViews = Math.round(totalViews / metrics.length);
      const avgLikes = Math.round(totalLikes / metrics.length);
      const avgComments = Math.round(totalReplies / metrics.length);
      const avgReposts = Math.round(totalReposts / metrics.length);

      lead.avg_views = avgViews;
      lead.avg_likes = avgLikes;
      lead.avg_comments = avgComments;
      lead.avg_reposts = avgReposts;
      lead.score = computeScore(avgViews, avgLikes, avgComments, avgReposts, lead.followers ?? 0);

      enriched++;
      console.log(` views=${avgViews} likes=${avgLikes} comments=${avgComments} reposts=${avgReposts} score=${lead.score} (${metrics.length} tweets)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(` error: ${msg.slice(0, 100)}`);
      failed++;
    }

    // Save progress every 10 leads
    if ((enriched + failed) % 10 === 0) {
      writeFileSync(filepath, JSON.stringify(leads, null, 2));
      process.stdout.write("  [saved]\n");
    }

    // Rate limit: 1s between tweet fetches (X API limit is 1500 tweets/15min)
    if (i < needsEnrich.length - 1) {
      await sleep(1000);
    }
  }

  // Final save
  writeFileSync(filepath, JSON.stringify(leads, null, 2));

  console.log(`\n  Enrichment complete:`);
  console.log(`    Enriched: ${enriched}`);
  console.log(`    Failed: ${failed}`);
  console.log(`    Inactive: ${inactive}`);
  console.log(`  Saved to ${filepath}\n`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
