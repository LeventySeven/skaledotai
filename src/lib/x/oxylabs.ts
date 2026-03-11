import "server-only";
import type {
  XDataClient,
  XDiscoveryInput,
  XDiscoveryProvider,
  XLeadCandidate,
  XPostSearchResult,
  XProfilesPage,
  XResolvedTweet,
  XUserReference,
} from "./types";
import { XProviderRuntimeError } from "./types";
import { buildLeadCandidate } from "./discovery";
import { parseJsonResponse } from "./json";
import { asRecord, asArray } from "./records";
import {
  dedupeProfiles,
  normalizeHandle,
  normalizeScrapedProfile,
  normalizeScrapedTweet,
} from "./normalizers";
import { collectNestedTweets, requireUsername } from "./scraper-utils";

const OXYLABS_BASE_URL = process.env.OXYLABS_BASE_URL ?? "https://realtime.oxylabs.io/v1/queries";
const OXYLABS_DISCOVERY_URL_LIMIT = 12;
const OXYLABS_PROFILE_ENRICH_LIMIT = 24;
const OXYLABS_RESULT_MULTIPLIER = 4;

function unsupported(capability: "network"): never {
  throw new XProviderRuntimeError({
    provider: "oxylabs",
    capability,
    code: "CAPABILITY_UNSUPPORTED",
    message: `Oxylabs does not support ${capability} operations in the current integration.`,
  });
}

function requireOxylabsAuth(): { username: string; password: string } {
  const username = process.env.OXYLABS_USERNAME;
  const password = process.env.OXYLABS_PASSWORD;
  const fixtureReady = process.env.OXYLABS_FIXTURE_READY;
  const missingEnv = [
    !username ? "OXYLABS_USERNAME" : null,
    !password ? "OXYLABS_PASSWORD" : null,
    fixtureReady === "true" ? null : "OXYLABS_FIXTURE_READY",
  ].filter((value): value is string => Boolean(value));

  if (missingEnv.length > 0) {
    throw new XProviderRuntimeError({
      provider: "oxylabs",
      code: "NOT_CONFIGURED",
      message: "Oxylabs requires credentials and a verified fixture gate before it can be enabled.",
      missingEnv,
    });
  }

  return { username: username!, password: password! };
}

function getAuthHeader(): string {
  const { username, password } = requireOxylabsAuth();
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

async function queryOxylabs(
  url: string,
  capability: "discovery" | "lookup" | "tweets",
): Promise<unknown> {
  const response = await fetch(OXYLABS_BASE_URL, {
    method: "POST",
    headers: {
      "Authorization": getAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source: "universal",
      url,
      parse: true,
      render: "html",
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new XProviderRuntimeError({
      provider: "oxylabs",
      capability,
      code: response.status === 429 ? "UPSTREAM_RATE_LIMITED" : "UPSTREAM_REQUEST_FAILED",
      message: `Oxylabs request failed (${response.status}): ${await response.text()}`,
    });
  }

  return parseJsonResponse<unknown>(
    response,
    (details) => new XProviderRuntimeError({
      provider: "oxylabs",
      capability,
      code: "UPSTREAM_INVALID_RESPONSE",
      message: `Oxylabs returned a non-JSON response. ${details}`,
    }),
  );
}

function extractOxylabsItems(value: unknown): unknown[] {
  const record = asRecord(value);
  if (!record) return [];

  const directItems = [
    ...asArray(record.results),
    ...asArray(record.items),
    ...asArray(record.data),
  ];

  const flattened = directItems.flatMap((item) => {
    const child = asRecord(item);
    if (!child) return [item];
    return [
      child,
      ...asArray(child.results),
      ...asArray(child.items),
      ...asArray(child.data),
      ...asArray(child.content),
      ...(child.content ? [child.content] : []),
      ...(child.page ? [child.page] : []),
      ...(child.parsed ? [child.parsed] : []),
    ];
  });

  return flattened.length > 0 ? flattened : [record];
}

function normalizeProfiles(payload: unknown): ReturnType<typeof dedupeProfiles> {
  return dedupeProfiles(
    extractOxylabsItems(payload)
      .map((item) => normalizeScrapedProfile(item))
      .filter((profile): profile is NonNullable<ReturnType<typeof normalizeScrapedProfile>> => Boolean(profile)),
  );
}

function normalizeSearchResult(payload: unknown): XPostSearchResult {
  const items = extractOxylabsItems(payload);
  const tweets = items
    .map((item) => normalizeScrapedTweet(item))
    .filter((tweet): tweet is XResolvedTweet => Boolean(tweet));
  const users = dedupeProfiles(
    items
      .map((item) => normalizeScrapedProfile(item))
      .filter((profile): profile is NonNullable<ReturnType<typeof normalizeScrapedProfile>> => Boolean(profile)),
  );

  return { tweets, users };
}

async function scrapeProfile(
  reference: XUserReference,
  capability: "discovery" | "lookup" | "tweets" = "lookup",
): Promise<unknown> {
  const username = requireUsername(reference, "Oxylabs");
  return queryOxylabs(`https://x.com/${username}`, capability);
}

function buildOxylabsSearchUrl(query: string, filter: "user" | "live" | "top"): string {
  return `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=${filter}`;
}

export function buildOxylabsDiscoveryUrls(input: XDiscoveryInput): string[] {
  const niche = input.niche.trim();
  const seedHandle = input.seedHandle?.replace(/^@/, "").trim();
  const queryVariants = [
    niche,
    `"${niche}"`,
    `${niche} founder`,
    `${niche} builder`,
    `${niche} engineer`,
    `${niche} creator`,
    `${niche} operator`,
    seedHandle ? `${niche} from:${seedHandle}` : "",
    seedHandle ? `to:${seedHandle} ${niche}` : "",
    seedHandle ? `${niche} people similar to @${seedHandle}` : "",
  ].filter(Boolean);

  const seen = new Set<string>();
  const urls: string[] = [];

  for (const query of queryVariants) {
    for (const filter of ["user", "live", "top"] as const) {
      const url = buildOxylabsSearchUrl(query, filter);
      if (seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
      if (urls.length >= OXYLABS_DISCOVERY_URL_LIMIT) return urls;
    }
  }

  return urls;
}

export const oxylabsDiscoveryProvider: XDiscoveryProvider = {
  provider: "oxylabs",
  async discoverCandidates(input: XDiscoveryInput): Promise<XLeadCandidate[]> {
    const results = await Promise.all(buildOxylabsDiscoveryUrls(input).map((url) => queryOxylabs(url, "discovery")));
    const byHandle = new Map<string, XLeadCandidate>();

    for (const result of results) {
      const search = normalizeSearchResult(result);

      for (const profile of search.users) {
        const tweets = search.tweets.filter((tweet) => tweet.authorId === profile.xUserId);
        const candidate = buildLeadCandidate(
          "oxylabs",
          input.niche,
          profile,
          tweets.length > 0 ? "post_search" : "profile_search",
          tweets,
        );

        if (candidate.account.followers < (input.minFollowers ?? 0)) continue;
        byHandle.set(candidate.account.handle.toLowerCase(), candidate);
      }
    }

    const enrichHandles = [...byHandle.values()]
      .sort((a, b) => b.account.followers - a.account.followers)
      .slice(0, Math.max(OXYLABS_PROFILE_ENRICH_LIMIT, input.limit))
      .map((candidate) => candidate.account.handle);

    const enrichedPayloads = await Promise.all(
      [...new Set(enrichHandles)].map(async (handle) => ({
        handle,
        payload: await scrapeProfile({ username: handle }, "discovery"),
      })),
    );

    for (const { handle, payload } of enrichedPayloads) {
      const profiles = normalizeProfiles(payload);
      const profile = profiles.find((item) => item.username.toLowerCase() === handle.toLowerCase()) ?? profiles[0];
      if (!profile) continue;

      const tweets = collectNestedTweets(extractOxylabsItems(payload)).slice(0, 12);
      const candidate = buildLeadCandidate(
        "oxylabs",
        input.niche,
        profile,
        tweets.length > 0 ? "post_search" : "profile_search",
        tweets,
      );

      if (candidate.account.followers < (input.minFollowers ?? 0)) continue;
      byHandle.set(candidate.account.handle.toLowerCase(), candidate);
    }

    return [...byHandle.values()]
      .sort((a, b) => b.account.followers - a.account.followers)
      .slice(0, Math.max(20, input.limit * OXYLABS_RESULT_MULTIPLIER));
  },
};

export const oxylabsClient: XDataClient = {
  provider: "oxylabs",
  async searchUsers(query, maxResults = 25) {
    const candidates = await oxylabsDiscoveryProvider.discoverCandidates({ niche: query, limit: maxResults });
    return candidates.slice(0, maxResults).map((candidate) => ({
      xUserId: candidate.account.xUserId ?? candidate.account.handle,
      username: candidate.account.handle,
      displayName: candidate.account.name,
      bio: candidate.account.bio,
      followersCount: candidate.account.followers,
      followingCount: candidate.account.following,
      verified: candidate.account.isVerified,
      profileUrl: candidate.account.profileUrl,
      avatarUrl: candidate.account.avatarUrl,
    }));
  },
  async lookupUsersByUsernames(usernames) {
    const handles = [...new Set(usernames.map((username) => normalizeHandle(username)).filter(Boolean))];
    const payloads = await Promise.all(handles.map((handle) => scrapeProfile({ username: handle }, "lookup")));
    return dedupeProfiles(payloads.flatMap((payload) => normalizeProfiles(payload)));
  },
  getFollowersPage(): Promise<XProfilesPage> {
    unsupported("network");
  },
  getFollowingPage(): Promise<XProfilesPage> {
    unsupported("network");
  },
  async searchRecentPosts(query, maxResults = 50) {
    const payload = await queryOxylabs(
      `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`,
      "tweets",
    );
    const result = normalizeSearchResult(payload);
    return {
      tweets: result.tweets.slice(0, maxResults),
      users: result.users.slice(0, maxResults),
    };
  },
  searchAllPosts(query, maxResults = 50) {
    return oxylabsClient.searchRecentPosts(query, maxResults);
  },
  async getUserTweets(input) {
    const payload = await scrapeProfile(input, "tweets");
    return collectNestedTweets(extractOxylabsItems(payload)).slice(0, input.maxResults ?? 30);
  },
};
