import "server-only";
import { TRPCError } from "@trpc/server";
import { screenProfilesForLeadSearch } from "@/lib/openai";
import type { Lead } from "@/lib/validations/leads";
import type { Project } from "@/lib/validations/projects";
import type { SearchLeadInput, XProfile } from "@/lib/validations/search";
import {
  getXDataClientForCapability,
  getXDiscoveryProvider,
  resolveXProviderForCapability,
} from "@/lib/x/client";
import type { XDataProvider, XLeadCandidate, XProviderCapability } from "@/lib/x";
import { XProviderRuntimeError } from "@/lib/x";
import { addProfilesToProject } from "./leads";
import { recordProjectRun } from "./project-runs";
import { createProject, getProjectById } from "./projects";
import { getCandidateSampleTexts, toXProfileFromCandidate } from "@/lib/x/discovery";
import { NETWORK_TARGET, SEARCH_TARGET, X_PROVIDER_NETWORK_PAGE_SIZE } from "@/lib/constants";

type CanonicalCandidate = XProfile & {
  samplePosts: string[];
  source: XLeadCandidate["discoverySource"];
};

function toProviderError(error: unknown): TRPCError {
  if (error instanceof TRPCError) return error;

  if (error instanceof XProviderRuntimeError) {
    const suffix = error.missingEnv.length > 0
      ? ` Missing configuration: ${error.missingEnv.join(", ")}.`
      : "";
    return new TRPCError({
      code: "BAD_REQUEST",
      message: `${error.message}${suffix}`,
      cause: error,
    });
  }

  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: error instanceof Error ? error.message : "Unexpected X provider failure.",
    cause: error instanceof Error ? error : undefined,
  });
}

function dedupeProviders(providers: XDataProvider[]): XDataProvider[] {
  return [...new Set(providers)];
}

function byFollowersDesc(a: XLeadCandidate, b: XLeadCandidate): number {
  return b.account.followers - a.account.followers;
}

function buildScreeningPool(candidates: XLeadCandidate[], targetLeadCount: number): XLeadCandidate[] {
  const headCount = Math.min(candidates.length, Math.max(targetLeadCount, Math.ceil(targetLeadCount * 1.4)));
  const seen = new Set<string>();
  const pool: XLeadCandidate[] = [];

  function push(candidate: XLeadCandidate): void {
    const key = candidate.account.handle.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    pool.push(candidate);
  }

  for (const candidate of candidates.slice(0, headCount)) push(candidate);
  for (const candidate of candidates.filter((candidate) => candidate.posts.length > 0)) push(candidate);
  for (const candidate of candidates.filter((candidate) => candidate.discoverySource === "profile_search" || candidate.discoverySource === "reply_search")) {
    push(candidate);
  }
  for (const candidate of candidates) push(candidate);

  return pool;
}

function toScreeningCandidate(candidate: XLeadCandidate): XProfile & { samplePosts: string[]; source: string } {
  return {
    ...toXProfileFromCandidate(candidate),
    samplePosts: getCandidateSampleTexts(candidate),
    source: candidate.discoverySource,
  };
}

async function resolveProject(userId: string, input: SearchLeadInput): Promise<Project> {
  if (input.projectId) {
    const existing = await getProjectById(userId, input.projectId);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
    return existing;
  }

  return createProject(userId, {
    name: input.projectName?.trim() || input.query.trim(),
    query: input.query.trim(),
    seedUsername: input.followerUsername?.replace(/^@/, ""),
  });
}

async function canonicalizeCandidates(
  provider: XDataProvider,
  candidates: XLeadCandidate[],
): Promise<{ profiles: CanonicalCandidate[]; lookupProvider: XDataProvider }> {
  const { client, resolution } = getXDataClientForCapability(provider, "lookup");
  const handles = [...new Set(candidates.map((candidate) => candidate.account.handle.replace(/^@/, "").trim()).filter(Boolean))];
  const lookedUpProfiles = handles.length > 0 ? await client.lookupUsersByUsernames(handles) : [];
  const profilesByHandle = new Map(
    lookedUpProfiles.map((profile) => [profile.username.toLowerCase(), profile]),
  );

  const profiles = candidates.map((candidate) => {
    const handle = candidate.account.handle.replace(/^@/, "").toLowerCase();
    const canonical = profilesByHandle.get(handle);

    return {
      ...(canonical ?? toXProfileFromCandidate(candidate)),
      samplePosts: getCandidateSampleTexts(candidate),
      source: candidate.discoverySource,
    };
  });

  return { profiles, lookupProvider: resolution.effectiveProvider };
}

function resolveOperationProviders(requestedProvider: XDataProvider): Record<XProviderCapability, XDataProvider> {
  return {
    discovery: resolveXProviderForCapability(requestedProvider, "discovery").effectiveProvider,
    lookup: resolveXProviderForCapability(requestedProvider, "lookup").effectiveProvider,
    network: resolveXProviderForCapability(requestedProvider, "network").effectiveProvider,
    tweets: resolveXProviderForCapability(requestedProvider, "tweets").effectiveProvider,
  };
}

export async function searchAndAddLeads(
  userId: string,
  input: SearchLeadInput,
  provider: XDataProvider = "x-api",
): Promise<{ leads: Lead[]; project: Project }> {
  try {
    const targetLeadCount = input.targetLeadCount ?? SEARCH_TARGET;
    const { provider: discoveryProvider } = getXDiscoveryProvider(provider);
    const discoveredCandidates = await discoveryProvider.discoverCandidates({
      niche: input.query,
      seedHandle: input.followerUsername?.replace(/^@/, ""),
      limit: targetLeadCount,
      minFollowers: input.minFollowers ?? 0,
    });

    if (discoveredCandidates.length === 0) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message:
          (input.minFollowers ?? 0) > 0
            ? `No relevant X leads found for this query with at least ${input.minFollowers} followers.`
            : "No relevant X leads found for this query.",
      });
    }

    const screeningPool = buildScreeningPool(
      discoveredCandidates
        .filter((candidate) => candidate.account.followers >= (input.minFollowers ?? 0))
        .sort(byFollowersDesc),
      targetLeadCount,
    );

    const selectedIds = await screenProfilesForLeadSearch(
      input.query,
      screeningPool.map(toScreeningCandidate),
      targetLeadCount,
    );
    const selectedSet = new Set(selectedIds);
    const screenedCandidates = screeningPool.filter((candidate) =>
      selectedSet.has(candidate.account.xUserId ?? candidate.account.handle.replace(/^@/, "").toLowerCase())
      || selectedSet.has(candidate.account.handle.replace(/^@/, "").toLowerCase()),
    );

    if (screenedCandidates.length === 0) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "No relevant X leads passed AI filtering for this query.",
      });
    }

    const { profiles, lookupProvider } = await canonicalizeCandidates(provider, screenedCandidates);
    const project = await resolveProject(userId, input);
    const leadsList = await addProfilesToProject({
      userId,
      projectId: project.id,
      profiles,
      discoverySource: input.followerUsername ? "followers" : "profile_search",
      discoveryQuery: input.query,
    });

    const operationProviders = resolveOperationProviders(provider);
    await recordProjectRun({
      projectId: project.id,
      operationType: "search",
      requestedProvider: provider,
      discoveryProvider: discoveryProvider.provider,
      lookupProvider,
      networkProvider: operationProviders.network,
      tweetsProvider: operationProviders.tweets,
      query: input.query,
      seedUsername: input.followerUsername?.replace(/^@/, ""),
      leadCount: leadsList.length,
    });

    return {
      leads: leadsList,
      project: {
        ...project,
        sourceProviders: dedupeProviders([...project.sourceProviders, provider]),
      },
    };
  } catch (error) {
    throw toProviderError(error);
  }
}

export async function importAccountNetwork(
  userId: string,
  input: { username: string; projectId?: string; projectName?: string },
  provider: XDataProvider = "x-api",
): Promise<{ leads: Lead[]; project: Project }> {
  try {
    const lookup = getXDataClientForCapability(provider, "lookup");
    const network = getXDataClientForCapability(provider, "network");
    const tweetsProvider = resolveXProviderForCapability(provider, "tweets").effectiveProvider;

    const cleanHandle = input.username.replace(/^@/, "").trim();
    const [seed] = await lookup.client.lookupUsersByUsernames([cleanHandle]);
    if (!seed) throw new TRPCError({ code: "NOT_FOUND", message: "X account not found." });

    const project = await resolveProject(userId, {
      query: `${cleanHandle} network`,
      projectId: input.projectId,
      projectName: input.projectName || `${cleanHandle} network`,
      followerUsername: cleanHandle,
    });

    const candidates = new Map<string, CanonicalCandidate>();
    let nextFollowers: string | undefined;
    let nextFollowing: string | undefined;
    let fetched = 0;

    while (fetched < NETWORK_TARGET) {
      const [followersPage, followingPage] = await Promise.all([
        network.client.getFollowersPage({
          userId: seed.xUserId,
          username: seed.username,
          paginationToken: nextFollowers,
          maxResults: X_PROVIDER_NETWORK_PAGE_SIZE,
        }),
        network.client.getFollowingPage({
          userId: seed.xUserId,
          username: seed.username,
          paginationToken: nextFollowing,
          maxResults: X_PROVIDER_NETWORK_PAGE_SIZE,
        }),
      ]);

      for (const profile of followersPage.profiles) {
        candidates.set(profile.username.toLowerCase(), { ...profile, samplePosts: [], source: "followers" });
      }
      for (const profile of followingPage.profiles) {
        candidates.set(profile.username.toLowerCase(), { ...profile, samplePosts: [], source: "following" });
      }

      fetched += followersPage.profiles.length + followingPage.profiles.length;
      nextFollowers = followersPage.nextToken;
      nextFollowing = followingPage.nextToken;

      if ((!nextFollowers && !nextFollowing) || (followersPage.profiles.length === 0 && followingPage.profiles.length === 0)) {
        break;
      }
    }

    const leadsList = await addProfilesToProject({
      userId,
      projectId: project.id,
      profiles: [...candidates.values()],
      discoverySource: "followers",
      discoveryQuery: cleanHandle,
    });

    await recordProjectRun({
      projectId: project.id,
      operationType: "network_import",
      requestedProvider: provider,
      discoveryProvider: resolveXProviderForCapability(provider, "discovery").effectiveProvider,
      lookupProvider: lookup.resolution.effectiveProvider,
      networkProvider: network.resolution.effectiveProvider,
      tweetsProvider,
      query: `${cleanHandle} network`,
      seedUsername: cleanHandle,
      leadCount: leadsList.length,
    });

    return {
      leads: leadsList,
      project: {
        ...project,
        sourceProviders: dedupeProviders([...project.sourceProviders, provider]),
      },
    };
  } catch (error) {
    throw toProviderError(error);
  }
}
