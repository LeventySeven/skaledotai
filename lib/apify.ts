const TOKEN = process.env.APIFY_API_TOKEN;
if (!TOKEN) throw new Error("APIFY_API_TOKEN is not set");

const BASE = "https://api.apify.com/v2";

export const ACTORS = {
  twitterSearch: "apidojo/tweet-scraper",
  twitterFollowers: "kaitoeasyapi/premium-x-follower-scraper-following-data",
  linkedinSearch: "harvestapi/linkedin-profile-search",
  emailEnrich: "parvenu/email-enrichment",
} as const;

export type ActorId = (typeof ACTORS)[keyof typeof ACTORS];

/** Run an actor synchronously and return dataset items. */
export async function runActor<T = Record<string, unknown>>(
  actorId: string,
  input: Record<string, unknown>,
  waitSecs = 90,
): Promise<T[]> {
  const encoded = encodeURIComponent(actorId);
  const runRes = await fetch(
    `${BASE}/acts/${encoded}/runs?token=${TOKEN}&waitForFinish=${waitSecs}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!runRes.ok) {
    const text = await runRes.text();
    throw new Error(`Apify run failed (${runRes.status}): ${text}`);
  }
  const { data: run } = await runRes.json() as { data: { defaultDatasetId: string } };

  // Paginate through dataset
  const all: T[] = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const dsRes = await fetch(
      `${BASE}/datasets/${run.defaultDatasetId}/items?token=${TOKEN}&offset=${offset}&limit=${limit}`,
    );
    if (!dsRes.ok) break;
    const items = await dsRes.json() as T[];
    all.push(...items);
    if (items.length < limit) break;
    offset += limit;
  }
  return all;
}

/** Thin wrapper used by enrich route — runs actor with its own waitSecs */
export const apify = {
  actor: (actorId: string) => ({
    call: async (input: Record<string, unknown>, opts?: { waitSecs?: number }) => {
      const encoded = encodeURIComponent(actorId);
      const waitSecs = opts?.waitSecs ?? 90;
      const runRes = await fetch(
        `${BASE}/acts/${encoded}/runs?token=${TOKEN}&waitForFinish=${waitSecs}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      if (!runRes.ok) {
        const text = await runRes.text();
        throw new Error(`Apify run failed (${runRes.status}): ${text}`);
      }
      const { data } = await runRes.json() as { data: { defaultDatasetId: string } };
      return data;
    },
  }),
  dataset: (datasetId: string) => ({
    listItems: async (opts?: { limit?: number }) => {
      const limit = opts?.limit ?? 100;
      const res = await fetch(
        `${BASE}/datasets/${datasetId}/items?token=${TOKEN}&limit=${limit}`,
      );
      if (!res.ok) return { items: [] };
      const items = await res.json();
      return { items };
    },
  }),
};
