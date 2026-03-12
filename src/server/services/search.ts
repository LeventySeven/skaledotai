import "server-only";
import { TRPCError } from "@trpc/server";
import { expandLeadSearchQueries, screenProfilesForLeadSearchDetailed } from "@/lib/openai";
import type { Lead } from "@/lib/validations/leads";
import type { Project } from "@/lib/validations/projects";
import type {
  ProjectRunTrace,
  ProjectRunTraceMetric,
  ProjectRunTraceStep,
  ProjectRunTraceStatus,
} from "@/lib/validations/project-runs";
import type {
  SearchLeadInput,
  SearchRunResult,
  SearchRunStreamSnapshot,
  XProfile,
} from "@/lib/validations/search";
import {
  getXDataClientForCapability,
  getXDiscoveryProvider,
  resolveXProviderForCapability,
  type XProviderResolution,
} from "@/lib/x/registry";
import {
  XProviderRuntimeError,
  type XDataProvider,
  type XDiscoveryProvider,
  type XLeadCandidate,
  type XProviderCapability,
} from "@/lib/x";
import { addProfilesToProject } from "./leads";
import { createProjectRunTraceBuilder } from "./project-run-trace";
import { recordProjectRun } from "./project-runs";
import { createProject, getProjectById } from "./projects";
import { getCandidateSampleTexts, toXProfileFromCandidate } from "@/lib/x/discovery";
import {
  NETWORK_TARGET,
  SEARCH_DISCOVERY_METADATA,
  SEARCH_TARGET,
  SEARCH_TARGET_MAX,
  X_PROVIDER_NETWORK_PAGE_SIZE,
} from "@/lib/constants";
import { toXProviderTrpcError } from "@/lib/x/error-handling";

type CanonicalCandidate = XProfile & {
  samplePosts: string[];
  source: XLeadCandidate["discoverySource"];
};

type SearchProgressHandlers = {
  onStep?: (step: ProjectRunTraceStep) => void | Promise<void>;
  onSnapshot?: (snapshot: SearchRunStreamSnapshot) => void | Promise<void>;
};

function aggregateDiscoverySnapshots(
  snapshots: Iterable<SearchRunStreamSnapshot>,
): SearchRunStreamSnapshot {
  const total = {
    queries: 0,
    urls: 0,
    scraped: 0,
    candidates: 0,
  };

  for (const snapshot of snapshots) {
    total.queries += snapshot.queries;
    total.urls += snapshot.urls;
    total.scraped += snapshot.scraped;
    total.candidates += snapshot.candidates;
  }

  return total;
}

function createDiscoveryProgressHandlers(
  progress: SearchProgressHandlers | undefined,
  input: {
    attemptKey: string;
    attemptLabel: string;
    query: string;
    snapshotStore: Map<string, SearchRunStreamSnapshot>;
  },
): SearchProgressHandlers {
  if (!progress?.onStep && !progress?.onSnapshot) {
    return {};
  }

  return {
    onStep: progress.onStep
      ? async (step) => {
        await progress.onStep?.({
          ...step,
          id: `${input.attemptKey}:${step.id}`,
          title: `${input.attemptLabel} · ${step.title}`,
          bullets: [
            `Discovery query: ${input.query}`,
            ...step.bullets,
          ],
        });
      }
      : undefined,
    onSnapshot: progress.onSnapshot
      ? async (snapshot) => {
        input.snapshotStore.set(input.attemptKey, snapshot);
        await progress.onSnapshot?.(aggregateDiscoverySnapshots(input.snapshotStore.values()));
      }
      : undefined,
  };
}

function dedupeProviders(providers: XDataProvider[]): XDataProvider[] {
  return [...new Set(providers)];
}

async function emitStep(
  handlers: SearchProgressHandlers | undefined,
  input: {
    id: string;
    title: string;
    summary: string;
    status: ProjectRunTraceStatus;
    provider?: XDataProvider;
    model?: string;
    bullets?: string[];
    metrics?: ProjectRunTraceMetric[];
  },
): Promise<ProjectRunTraceStep> {
  const step: ProjectRunTraceStep = {
    id: input.id,
    title: input.title,
    summary: input.summary,
    status: input.status,
    provider: input.provider,
    model: input.model,
    bullets: input.bullets ?? [],
    metrics: input.metrics ?? [],
  };

  await handlers?.onStep?.(step);
  return step;
}

function getDiscoveryMinFollowers(provider: XDataProvider, minFollowers: number): number {
  return provider === "x-api" ? 0 : minFollowers;
}

function byFollowersDesc(a: XLeadCandidate, b: XLeadCandidate): number {
  return b.account.followers - a.account.followers;
}

function dedupeCandidates(candidates: XLeadCandidate[]): XLeadCandidate[] {
  const byHandle = new Map<string, XLeadCandidate>();

  for (const candidate of candidates) {
    const key = candidate.account.handle.replace(/^@/, "").toLowerCase();
    const existing = byHandle.get(key);
    if (!existing || candidate.account.followers > existing.account.followers) {
      byHandle.set(key, candidate);
    }
  }

  return [...byHandle.values()];
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
): Promise<{ profiles: CanonicalCandidate[]; resolution: XProviderResolution }> {
  try {
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

    return { profiles, resolution };
  } catch (error) {
    if (!(error instanceof XProviderRuntimeError) || error.code !== "CAPABILITY_UNSUPPORTED") {
      throw error;
    }

    return {
      profiles: candidates.map((candidate) => ({
        ...toXProfileFromCandidate(candidate),
        samplePosts: getCandidateSampleTexts(candidate),
        source: candidate.discoverySource,
      })),
      resolution: {
        requestedProvider: provider,
        effectiveProvider: provider,
        capability: "lookup",
        usedFallback: false,
      },
    };
  }
}

async function discoverCandidatesWithRetry(
  discoveryProvider: XDiscoveryProvider,
  query: string,
  seedHandle: string | undefined,
  minFollowers: number,
  parseAccountsTarget: number,
  progress?: SearchProgressHandlers,
): Promise<{
  candidates: XLeadCandidate[];
  firstPassCount: number;
  retryQueries: string[];
}> {
  const discoveryMinFollowers = getDiscoveryMinFollowers(discoveryProvider.provider, minFollowers);
  const discoverySnapshots = new Map<string, SearchRunStreamSnapshot>();
  const firstPassProgress = createDiscoveryProgressHandlers(progress, {
    attemptKey: "pass-1",
    attemptLabel: "Pass 1",
    query,
    snapshotStore: discoverySnapshots,
  });
  const firstPass = await discoveryProvider.discoverCandidates({
    niche: query,
    seedHandle,
    limit: parseAccountsTarget,
    minFollowers: discoveryMinFollowers,
    traceRecorder: firstPassProgress.onStep,
    snapshotRecorder: firstPassProgress.onSnapshot,
  });

  const firstFiltered = firstPass.filter((candidate) => candidate.account.followers >= minFollowers);
  if (firstFiltered.length >= SEARCH_DISCOVERY_METADATA.minimumFinalLeadsBeforeRetry) {
    return {
      candidates: dedupeCandidates(firstFiltered),
      firstPassCount: firstPass.length,
      retryQueries: [],
    };
  }

  const retryQueries = (await expandLeadSearchQueries(query, seedHandle))
    .filter((item) => item.trim().toLowerCase() !== query.trim().toLowerCase());
  const retryPasses = await Promise.all(
    retryQueries.map((retryQuery, index) => {
      const retryProgress = createDiscoveryProgressHandlers(progress, {
        attemptKey: `retry-${index + 1}`,
        attemptLabel: `Retry ${index + 1}`,
        query: retryQuery,
        snapshotStore: discoverySnapshots,
      });

      return discoveryProvider.discoverCandidates({
        niche: retryQuery,
        seedHandle,
        limit: parseAccountsTarget,
        minFollowers: discoveryMinFollowers,
        traceRecorder: retryProgress.onStep,
        snapshotRecorder: retryProgress.onSnapshot,
      });
    }),
  );

  return {
    candidates: dedupeCandidates(
      [...firstPass, ...retryPasses.flat()]
        .filter((candidate) => candidate.account.followers >= minFollowers),
    ),
    firstPassCount: firstPass.length,
    retryQueries,
  };
}

function resolveSearchOperationProviders(
  requestedProvider: XDataProvider,
  lookupProvider: XDataProvider,
): Record<XProviderCapability, XDataProvider> {
  return {
    discovery: requestedProvider,
    lookup: lookupProvider,
    network: requestedProvider,
    tweets: requestedProvider,
  };
}

function getDiscoveryParseTarget(provider: XDataProvider, targetLeadCount: number): number {
  if (provider === "x-api") return SEARCH_DISCOVERY_METADATA.parseAccountsTarget;
  return Math.max(targetLeadCount, Math.min(SEARCH_TARGET_MAX, Math.ceil(targetLeadCount * 1.2)));
}

export async function searchAndAddLeads(
  userId: string,
  input: SearchLeadInput,
  provider: XDataProvider = "x-api",
  progress?: SearchProgressHandlers,
): Promise<SearchRunResult> {
  try {
    const trace = createProjectRunTraceBuilder({
      title: "Lead Search",
      operationType: "search",
      requestedProvider: provider,
    });
    const project = await resolveProject(userId, input);
    const targetLeadCount = input.targetLeadCount ?? SEARCH_TARGET;
    const { provider: discoveryProvider } = getXDiscoveryProvider(provider);
    const seedHandle = input.followerUsername?.replace(/^@/, "");
    const minFollowers = input.minFollowers ?? 0;
    const parseAccountsTarget = getDiscoveryParseTarget(provider, targetLeadCount);
    const discoveryResult = await discoverCandidatesWithRetry(
      discoveryProvider,
      input.query,
      seedHandle,
      minFollowers,
      parseAccountsTarget,
      progress,
    );
    const discoveredCandidates = discoveryResult.candidates;

    trace.addStep(await emitStep(progress, {
      id: "discovery-summary",
      title: "Discovery",
      summary: `Collected ${discoveredCandidates.length} candidate accounts for ${input.query}.`,
      status: "success",
      provider: discoveryProvider.provider,
      bullets: [
        seedHandle ? `Seed handle: @${seedHandle}` : "No seed handle used.",
        discoveryResult.retryQueries.length > 0
          ? `Expanded to ${discoveryResult.retryQueries.length} retry queries when the first pass came back light.`
          : "The first-pass query returned enough candidates, so no retry expansion was needed.",
      ],
      metrics: [
        { label: "Target", value: targetLeadCount },
        { label: "Parse pool", value: parseAccountsTarget },
        { label: "First pass", value: discoveryResult.firstPassCount },
        { label: "Final candidates", value: discoveredCandidates.length },
      ],
    }));

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
        .sort(byFollowersDesc),
      targetLeadCount,
    );

    const screeningResult = await screenProfilesForLeadSearchDetailed(
      input.query,
      screeningPool.map(toScreeningCandidate),
      targetLeadCount,
    );
    const selectedIds = screeningResult.selectedIds;
    const selectedSet = new Set(selectedIds);
    const screenedCandidates = screeningPool.filter((candidate) =>
      selectedSet.has(candidate.account.xUserId ?? candidate.account.handle.replace(/^@/, "").toLowerCase())
      || selectedSet.has(candidate.account.handle.replace(/^@/, "").toLowerCase()),
    );

    trace.addStep(await emitStep(progress, {
      id: "screening",
      title: "AI Screening",
      summary: `The model kept ${screenedCandidates.length} leads from a pool of ${screeningPool.length}.`,
      status: screeningResult.batchSummaries.some((batch) => batch.usedFallback) ? "warning" : "success",
      model: process.env.OPENAI_MODEL ?? "gpt-5",
      bullets: screeningResult.batchSummaries.map((batch, index) =>
        `Batch ${index + 1}: reviewed ${batch.candidateCount}, kept ${batch.includedCount}${batch.usedFallback ? " using fallback heuristics" : ""}.`,
      ),
      metrics: [
        { label: "Pool", value: screeningPool.length },
        { label: "Selected", value: screenedCandidates.length },
      ],
    }));

    if (screenedCandidates.length === 0) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "No relevant X leads passed AI filtering for this query.",
      });
    }

    const { profiles, resolution: lookupResolution } = await canonicalizeCandidates(provider, screenedCandidates);
    trace.addStep(await emitStep(progress, {
      id: "canonicalization",
      title: "Canonicalization",
      summary: `Prepared ${profiles.length} lead rows for insertion.`,
      status: lookupResolution.usedFallback ? "warning" : "success",
      provider: lookupResolution.effectiveProvider,
      bullets: [
        lookupResolution.usedFallback
          ? `Lookup fell back from ${provider} to ${lookupResolution.effectiveProvider} for stable profile details.`
          : `Profile lookup stayed on ${lookupResolution.effectiveProvider}.`,
      ],
      metrics: [
        { label: "Rows", value: profiles.length },
      ],
    }));
    const leadsList = await addProfilesToProject({
      userId,
      projectId: project.id,
      profiles,
      discoverySource: input.followerUsername ? "followers" : "profile_search",
      discoveryQuery: input.query,
    });

    trace.addStep(await emitStep(progress, {
      id: "insert",
      title: "Spreadsheet Insert",
      summary: `Inserted ${leadsList.length} rows into ${project.name}.`,
      status: "success",
      provider,
      bullets: [
        `Project: ${project.name}`,
      ],
      metrics: [
        { label: "Inserted", value: leadsList.length },
      ],
    }));

    const operationProviders = resolveSearchOperationProviders(provider, lookupResolution.effectiveProvider);
    await recordProjectRun({
      projectId: project.id,
      operationType: "search",
      requestedProvider: provider,
      discoveryProvider: discoveryProvider.provider,
      lookupProvider: lookupResolution.effectiveProvider,
      networkProvider: operationProviders.network,
      tweetsProvider: operationProviders.tweets,
      query: input.query,
      seedUsername: input.followerUsername?.replace(/^@/, ""),
      leadCount: leadsList.length,
    });

    const projectWithProviders = {
      ...project,
      sourceProviders: dedupeProviders([...project.sourceProviders, provider]),
    };
    const finalTrace = trace.build(`Added ${leadsList.length} leads to ${project.name}.`);

    return {
      leads: leadsList,
      project: projectWithProviders,
      trace: finalTrace,
    };
  } catch (error) {
    throw toXProviderTrpcError(error);
  }
}

export async function importAccountNetwork(
  userId: string,
  input: { username: string; projectId?: string; projectName?: string },
  provider: XDataProvider = "x-api",
): Promise<{ leads: Lead[]; project: Project; trace: ProjectRunTrace }> {
  try {
    const trace = createProjectRunTraceBuilder({
      title: "Network Import",
      operationType: "network_import",
      requestedProvider: provider,
    });
    const lookup = getXDataClientForCapability(provider, "lookup");
    const network = getXDataClientForCapability(provider, "network");
    const tweetsProvider = resolveXProviderForCapability(provider, "tweets").effectiveProvider;

    const cleanHandle = input.username.replace(/^@/, "").trim();
    const [seed] = await lookup.client.lookupUsersByUsernames([cleanHandle]);
    if (!seed) throw new TRPCError({ code: "NOT_FOUND", message: "X account not found." });

    trace.addStep({
      title: "Seed Lookup",
      summary: `Resolved @${cleanHandle} before importing the surrounding network.`,
      status: lookup.resolution.usedFallback ? "warning" : "success",
      provider: lookup.resolution.effectiveProvider,
      bullets: [
        lookup.resolution.usedFallback
          ? `Lookup fell back from ${provider} to ${lookup.resolution.effectiveProvider}.`
          : `Lookup stayed on ${lookup.resolution.effectiveProvider}.`,
      ],
      metrics: [
        { label: "Seed followers", value: seed.followersCount },
      ],
    });

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

    trace.addStep({
      title: "Network Sweep",
      summary: `Collected ${candidates.size} unique accounts from the followers and following graph.`,
      status: network.resolution.usedFallback ? "warning" : "success",
      provider: network.resolution.effectiveProvider,
      bullets: [
        network.resolution.usedFallback
          ? `Network fetch fell back from ${provider} to ${network.resolution.effectiveProvider}.`
          : `Network fetch stayed on ${network.resolution.effectiveProvider}.`,
      ],
      metrics: [
        { label: "Unique accounts", value: candidates.size },
      ],
    });

    const leadsList = await addProfilesToProject({
      userId,
      projectId: project.id,
      profiles: [...candidates.values()],
      discoverySource: "followers",
      discoveryQuery: cleanHandle,
    });

    trace.addStep({
      title: "Spreadsheet Insert",
      summary: `Inserted ${leadsList.length} rows into ${project.name}.`,
      status: "success",
      provider,
      metrics: [
        { label: "Inserted", value: leadsList.length },
      ],
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
      trace: trace.build(`Imported ${leadsList.length} network leads for @${cleanHandle}.`),
    };
  } catch (error) {
    throw toXProviderTrpcError(error);
  }
}
