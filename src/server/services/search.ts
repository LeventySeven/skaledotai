import "@/lib/server-runtime";
import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "@/db";
import { projectLeadInsights } from "@/db/schema";
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
  SEARCH_CANDIDATE_POOL_LIMIT,
  SEARCH_DISCOVERY_METADATA,
  SEARCH_TARGET,
  X_PROVIDER_NETWORK_PAGE_SIZE,
} from "@/lib/constants";
import { toXProviderTrpcError } from "@/lib/x/error-handling";
import {
  searchLeadMemory,
  mapMemoryHitToCandidate,
} from "./lead-memory";
import {
  getFollowerCacheStatus,
  fetchAndCacheFollowers,
  searchWithinFollowers,
} from "./follower-cache";

type CanonicalCandidate = XProfile & {
  samplePosts: string[];
  source: XLeadCandidate["discoverySource"];
};

type SearchProgressHandlers = {
  onStep?: (step: ProjectRunTraceStep) => void | Promise<void>;
  onSnapshot?: (snapshot: SearchRunStreamSnapshot) => void | Promise<void>;
};

type DiscoveryStopReason = "goal_reached" | "max_attempts" | "query_exhausted";
type DiscoveryRecoveryState = SearchRunStreamSnapshot["recoveryState"];

type SearchInterpretation = {
  roleTerms: string[];
  bioTerms: string[];
  antiGoals: string[];
};

type DiscoveryResult = {
  candidates: XLeadCandidate[];
  firstPassCount: number;
  retryQueries: string[];
  attemptedQueries: string[];
  attempts: number;
  maxAttempts: number;
  goalCount: number;
  satisfied: boolean;
  stopReason: DiscoveryStopReason;
  recoveryState?: DiscoveryRecoveryState;
  /** Interpreted search context from the planner — propagated to screening */
  interpretation?: SearchInterpretation;
};

function aggregateDiscoverySnapshots(
  snapshots: Iterable<SearchRunStreamSnapshot>,
): SearchRunStreamSnapshot {
  let latest: SearchRunStreamSnapshot | null = null;
  const total: SearchRunStreamSnapshot = {
    queries: 0,
    urls: 0,
    scraped: 0,
    candidates: 0,
    targetLeadCount: SEARCH_TARGET,
    goalCount: SEARCH_DISCOVERY_METADATA.minimumFinalLeadsBeforeRetry,
    attempt: 1,
    maxAttempts: 1,
    activeNode: undefined as string | undefined,
    activeSubagent: undefined as string | undefined,
    graphNodes: [],
  };

  for (const snapshot of snapshots) {
    total.queries += snapshot.queries;
    total.urls += snapshot.urls;
    total.scraped += snapshot.scraped;
    total.candidates += snapshot.candidates;

    if (!latest || snapshot.attempt >= latest.attempt) {
      latest = snapshot;
    }
  }

  if (latest) {
    total.targetLeadCount = latest.targetLeadCount;
    total.goalCount = latest.goalCount;
    total.attempt = latest.attempt;
    total.maxAttempts = latest.maxAttempts;
    total.activeNode = latest.activeNode;
    total.activeSubagent = latest.activeSubagent;
    total.graphNodes = latest.graphNodes;
  }

  return total;
}

function createDiscoveryProgressHandlers(
  progress: SearchProgressHandlers | undefined,
  input: {
    attemptKey: string;
    attemptLabel: string;
    attempt: number;
    maxAttempts: number;
    targetLeadCount: number;
    goalCount: number;
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
          metrics: [
            { label: "Attempt", value: `${input.attempt} / ${input.maxAttempts}` },
            { label: "Lead target (approx)", value: `~${input.targetLeadCount}` },
            { label: "Candidate goal", value: input.goalCount },
            ...step.metrics,
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
    subagent?: string;
    provider?: XDataProvider;
    model?: string;
    tools?: string[];
    bullets?: string[];
    metrics?: ProjectRunTraceMetric[];
  },
): Promise<ProjectRunTraceStep> {
  const step: ProjectRunTraceStep = {
    id: input.id,
    title: input.title,
    summary: input.summary,
    status: input.status,
    subagent: input.subagent,
    provider: input.provider,
    model: input.model,
    tools: input.tools ?? [],
    bullets: input.bullets ?? [],
    metrics: input.metrics ?? [],
  };

  await handlers?.onStep?.(step);
  return step;
}

function getDiscoveryMinFollowers(provider: XDataProvider, minFollowers: number): number {
  return provider === "x-api" ? 0 : minFollowers;
}

function byRelevanceDesc(a: XLeadCandidate, b: XLeadCandidate): number {
  // Prefer candidates with longer bios (more identity signal)
  return b.account.bio.length - a.account.bio.length;
}

function dedupeCandidates(candidates: XLeadCandidate[]): XLeadCandidate[] {
  const byHandle = new Map<string, XLeadCandidate>();

  for (const candidate of candidates) {
    const key = candidate.account.handle.replace(/^@/, "").toLowerCase();
    const existing = byHandle.get(key);
    // Keep the version with more posts (evidence of activity), then longer bio as tiebreaker
    if (!existing || candidate.posts.length > existing.posts.length || (candidate.posts.length === existing.posts.length && candidate.account.bio.length > existing.account.bio.length)) {
      byHandle.set(key, candidate);
    }
  }

  return [...byHandle.values()];
}

function buildScreeningPool(candidates: XLeadCandidate[], _targetLeadCount: number): XLeadCandidate[] {
  // Dedupe by handle, prefer longer bios. No post-based prioritization.
  const seen = new Map<string, XLeadCandidate>();
  for (const candidate of candidates) {
    const key = candidate.account.handle.replace(/^@/, "").toLowerCase();
    const existing = seen.get(key);
    if (!existing || candidate.account.bio.length > existing.account.bio.length) {
      seen.set(key, candidate);
    }
  }
  return [...seen.values()];
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
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found." });
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
    const ids = [...new Set(candidates.map((candidate) => candidate.account.xUserId?.trim()).filter((value): value is string => Boolean(value)))];
    let lookedUpProfiles: XProfile[] = [];

    if (ids.length > 0) {
      try {
        lookedUpProfiles = await client.lookupUsersByIds(ids);
      } catch (error) {
        if (!(error instanceof XProviderRuntimeError) || error.code !== "CAPABILITY_UNSUPPORTED") {
          throw error;
        }
      }
    }

    if (lookedUpProfiles.length === 0 && handles.length > 0) {
      lookedUpProfiles = await client.lookupUsersByUsernames(handles);
    }

    const profilesByHandle = new Map(lookedUpProfiles.map((profile) => [profile.username.toLowerCase(), profile]));
    const profilesById = new Map(lookedUpProfiles.map((profile) => [profile.xUserId, profile]));

    const profiles = candidates.map((candidate) => {
      const handle = candidate.account.handle.replace(/^@/, "").toLowerCase();
      const canonical = (
        candidate.account.xUserId ? profilesById.get(candidate.account.xUserId) : undefined
      ) ?? profilesByHandle.get(handle);

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

function getDiscoveryCandidateGoal(targetLeadCount: number): number {
  return Math.min(
    SEARCH_CANDIDATE_POOL_LIMIT,
    Math.max(
      SEARCH_DISCOVERY_METADATA.minimumFinalLeadsBeforeRetry,
      Math.ceil(targetLeadCount * SEARCH_DISCOVERY_METADATA.candidateGoalOverfetchFactor),
    ),
  );
}

function describeDiscoveryStopReason(reason: DiscoveryStopReason): string {
  if (reason === "goal_reached") return "The discovery goal was reached before the retry budget ran out.";
  if (reason === "max_attempts") return "The bounded retry budget was exhausted before the discovery goal was reached.";
  return "The queued discovery queries were exhausted before the discovery goal was reached.";
}

function describeDiscoveryRecoveryState(reason: DiscoveryRecoveryState): string {
  if (reason === "rate_limited") return "The recovery lane throttled the graph after upstream rate limits.";
  if (reason === "json_repair") return "The recovery lane switched into JSON repair mode after brittle upstream output.";
  if (reason === "low_yield") return "The recovery lane expanded the search when the current pass came back light.";
  if (reason === "precision_filtered") return "The recovery lane detected most candidates were wrong role and switched to roleTerms-targeted queries.";
  return "The graph stayed on the happy path without a recovery handoff.";
}

function enqueueUniqueQueries(
  queue: string[],
  seenQueries: Set<string>,
  queries: string[],
): string[] {
  const inserted: string[] = [];

  for (const query of queries.map((item) => item.trim()).filter(Boolean)) {
    const key = query.toLowerCase();
    if (seenQueries.has(key)) continue;
    seenQueries.add(key);
    queue.push(query);
    inserted.push(query);
  }

  return inserted;
}

async function discoverCandidatesUntilGoal(
  discoveryProvider: XDiscoveryProvider,
  query: string,
  seedHandle: string | undefined,
  minFollowers: number,
  targetLeadCount: number,
  parseAccountsTarget: number,
  progress?: SearchProgressHandlers,
): Promise<DiscoveryResult> {
  const discoveryMinFollowers = getDiscoveryMinFollowers(discoveryProvider.provider, minFollowers);
  const goalCount = getDiscoveryCandidateGoal(targetLeadCount);
  const maxAttempts = SEARCH_DISCOVERY_METADATA.maxAttempts;
  const discoverySnapshots = new Map<string, SearchRunStreamSnapshot>();
  const seenQueries = new Set<string>([query.trim().toLowerCase()]);
  const queuedQueries = [query.trim()];
  const attemptedQueries: string[] = [];
  const retryQueries: string[] = [];
  let combinedCandidates: XLeadCandidate[] = [];
  let firstPassCount = 0;
  let expansionLoaded = false;

  while (queuedQueries.length > 0 && attemptedQueries.length < maxAttempts && combinedCandidates.length < goalCount) {
    const currentQuery = queuedQueries.shift();
    if (!currentQuery) break;

    const attempt = attemptedQueries.length + 1;
    const attemptProgress = createDiscoveryProgressHandlers(progress, {
      attemptKey: attempt === 1 ? "pass-1" : `retry-${attempt - 1}`,
      attemptLabel: attempt === 1 ? "Pass 1" : `Retry ${attempt - 1}`,
      attempt,
      maxAttempts,
      targetLeadCount,
      goalCount,
      query: currentQuery,
      snapshotStore: discoverySnapshots,
    });

    const attemptCandidates = await discoveryProvider.discoverCandidates({
      niche: currentQuery,
      seedHandle,
      limit: parseAccountsTarget,
      minFollowers: discoveryMinFollowers,
      targetLeadCount,
      goalCount,
      attempt,
      maxAttempts,
      traceRecorder: attemptProgress.onStep,
      snapshotRecorder: attemptProgress.onSnapshot,
    });

    attemptedQueries.push(currentQuery);
    if (attempt === 1) firstPassCount = attemptCandidates.length;

    // minFollowers is applied inside the multiagent graph during candidate normalization.
    // Other providers may still need service-level filtering.
    combinedCandidates = dedupeCandidates(
      [...combinedCandidates, ...attemptCandidates],
    );

    if (!expansionLoaded && combinedCandidates.length < goalCount) {
      expansionLoaded = true;
      retryQueries.push(
        ...enqueueUniqueQueries(
          queuedQueries,
          seenQueries,
          (await expandLeadSearchQueries(query, seedHandle))
            .filter((item) => item.trim().toLowerCase() !== query.trim().toLowerCase()),
        ),
      );
    }
  }

  const satisfied = combinedCandidates.length >= goalCount;
  const stopReason: DiscoveryStopReason = satisfied
    ? "goal_reached"
    : attemptedQueries.length >= maxAttempts
      ? "max_attempts"
      : "query_exhausted";

  return {
    candidates: combinedCandidates,
    firstPassCount,
    retryQueries,
    attemptedQueries,
    attempts: attemptedQueries.length,
    maxAttempts,
    goalCount,
    satisfied,
    stopReason,
    recoveryState: undefined,
  };
}

async function discoverCandidatesWithProviderOwnedLoop(
  discoveryProvider: XDiscoveryProvider,
  query: string,
  seedHandle: string | undefined,
  minFollowers: number,
  targetLeadCount: number,
  parseAccountsTarget: number,
  progress?: SearchProgressHandlers,
  userId?: string,
): Promise<DiscoveryResult> {
  const discoveryMinFollowers = getDiscoveryMinFollowers(discoveryProvider.provider, minFollowers);
  const goalCount = getDiscoveryCandidateGoal(targetLeadCount);
  const maxAttempts = SEARCH_DISCOVERY_METADATA.maxAttempts;
  type DiscoverySnapshotSummary = {
    attempt?: number;
    maxAttempts?: number;
    stopReason?: DiscoveryStopReason;
    recoveryState?: DiscoveryRecoveryState;
    firstPassCount?: number;
  };
  let latestSnapshot: DiscoverySnapshotSummary | null = null;
  let capturedInterpretation: SearchInterpretation | undefined;

  const candidates = await discoveryProvider.discoverCandidates({
    niche: query,
    seedHandle,
    userId,
    limit: parseAccountsTarget,
    minFollowers: discoveryMinFollowers,
    targetLeadCount,
    goalCount,
    attempt: 1,
    maxAttempts,
    traceRecorder: progress?.onStep,
    snapshotRecorder: async (snapshot) => {
      latestSnapshot = snapshot;
      await progress?.onSnapshot?.(snapshot);
    },
    interpretationRecorder: (interpretation) => {
      capturedInterpretation = interpretation;
    },
  });
  const finalSnapshot = latestSnapshot as DiscoverySnapshotSummary | null | undefined;

  const satisfied = finalSnapshot?.stopReason === "goal_reached" || candidates.length >= goalCount;
  const stopReason: DiscoveryStopReason = finalSnapshot?.stopReason ?? (
    satisfied
      ? "goal_reached"
      : (finalSnapshot?.attempt ?? 1) >= maxAttempts
        ? "max_attempts"
        : "query_exhausted"
  );

  return {
    candidates,
    firstPassCount: finalSnapshot?.firstPassCount ?? candidates.length,
    retryQueries: [],
    attemptedQueries: [],
    attempts: finalSnapshot?.attempt ?? 1,
    maxAttempts: finalSnapshot?.maxAttempts ?? maxAttempts,
    goalCount,
    satisfied,
    stopReason,
    recoveryState: finalSnapshot?.recoveryState,
    interpretation: capturedInterpretation,
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

function getDiscoveryParseTarget(_provider: XDataProvider, targetLeadCount: number): number {
  return Math.max(
    SEARCH_DISCOVERY_METADATA.parseAccountsTarget,
    Math.ceil(targetLeadCount * 1.5),
  );
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

    console.log("[search] starting", JSON.stringify({
      query: input.query,
      seedHandle: seedHandle ?? null,
      enableWebSearch: input.enableWebSearch ?? false,
      minFollowers,
      targetLeadCount,
    }));

    // Progressive trace persistence — save to DB periodically so progress survives navigation.
    // Aligned with LangGraph checkpoint pattern: "save state at every super-step."
    const collectedSteps: Array<unknown> = [];
    let pendingSave: Promise<void> | null = null;
    const progressWithPersistence: SearchProgressHandlers | undefined = progress ? {
      onStep: async (step) => {
        collectedSteps.push(step);
        await progress.onStep?.(step);
        // Debounced save: persist every 5 steps or on first step
        if (collectedSteps.length === 1 || collectedSteps.length % 5 === 0) {
          const stepsSnapshot = [...collectedSteps];
          pendingSave = recordProjectRun({
            projectId: project.id,
            operationType: "search",
            requestedProvider: provider,
            discoveryProvider: discoveryProvider.provider,
            lookupProvider: provider,
            networkProvider: provider,
            tweetsProvider: provider,
            query: input.query,
            seedUsername: input.followerUsername?.replace(/^@/, ""),
            minFollowers: input.minFollowers,
            targetLeadCount: input.targetLeadCount,
            leadCount: 0,
            traceData: { steps: stepsSnapshot, status: "running" },
            status: "running",
          }).catch(() => undefined);
        }
      },
      onSnapshot: progress.onSnapshot,
    } : undefined;

    // ── Search within followers (TurboPuffer-cached) ─────────────────────────
    // If user specified a seed handle, search their cached verified followers first.
    // If cache doesn't exist yet, fetch → cache → then search.
    const knownHandles = new Set<string>();
    let screenedCandidates: XLeadCandidate[] = [];
    const enableWebSearch = input.enableWebSearch ?? false;

    if (seedHandle) {
      // ── Follower-only mode: fetch → cache → search within followers ────
      // When a seed handle is provided, ONLY search within that user's followers.
      // No warm/cold database search. No web search.

      // Check if followers are already cached
      const cacheStatus = await getFollowerCacheStatus(seedHandle);

      if (cacheStatus.state === "missing" || cacheStatus.state === "failed") {
        // Fetch and cache verified followers into TurboPuffer
        trace.addStep(await emitStep(progress, {
          id: "follower-fetch",
          title: "Fetching Verified Followers",
          summary: `Fetching verified followers of @${seedHandle} via TwitterAPI.io...`,
          status: "success",
          provider: "multiagent",
          tools: ["TwitterAPI.io", "TurboPuffer"],
          bullets: [`Caching @${seedHandle}'s verified followers for fast future searches.`],
          metrics: [],
        }));

        const result = await fetchAndCacheFollowers(seedHandle);

        trace.addStep(await emitStep(progress, {
          id: "follower-cached",
          title: "Followers Cached",
          summary: `Cached ${result.total} verified followers of @${seedHandle}.`,
          status: "success",
          provider: "multiagent",
          tools: ["TwitterAPI.io", "TurboPuffer"],
          bullets: [`${result.total} verified followers stored in TurboPuffer.`, "Future searches will be instant."],
          metrics: [{ label: "Followers cached", value: result.total }],
        }));
      } else if (cacheStatus.state === "fetching") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Still fetching @${seedHandle}'s followers. Please wait and try again.`,
        });
      }

      // Search within the cached followers
      const followerProfiles = await searchWithinFollowers({
        seedHandle,
        query: input.query,
        topK: Math.max(targetLeadCount, 100),
        minFollowers,
      });

      for (const profile of followerProfiles) {
        const handle = profile.username.replace(/^@/, "").toLowerCase();
        if (knownHandles.has(handle)) continue;
        knownHandles.add(handle);
        screenedCandidates.push({
          source: "multiagent",
          niche: input.query,
          discoverySource: "followers",
          account: {
            handle: profile.username,
            name: profile.displayName,
            bio: profile.bio,
            followers: profile.followersCount,
            following: profile.followingCount,
            isVerified: profile.verified,
            profileUrl: profile.profileUrl,
            avatarUrl: profile.avatarUrl,
            xUserId: profile.xUserId,
          },
          metrics: { avgLikes: 0, avgReplies: 0, avgReposts: 0, postsSampleSize: 0 },
          posts: [],
        });
      }

      trace.addStep(await emitStep(progress, {
        id: "follower-search",
        title: "Follower Search",
        summary: followerProfiles.length > 0
          ? `Found ${followerProfiles.length} matching followers of @${seedHandle}.`
          : `No followers of @${seedHandle} match "${input.query}".`,
        status: followerProfiles.length > 0 ? "success" : "warning",
        provider: "multiagent",
        tools: ["TurboPuffer"],
        bullets: followerProfiles.length > 0
          ? [`${followerProfiles.length} verified followers match "${input.query}".`]
          : [`No verified followers of @${seedHandle} match this query.`],
        metrics: [
          { label: "Matches", value: followerProfiles.length },
        ],
      }));

      if (screenedCandidates.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `No verified followers of @${seedHandle} match "${input.query}".`,
        });
      }

      // Skip straight to insertion — no database search, no web search
      const finalCandidates = screenedCandidates;
      const profiles = finalCandidates.map((c) => ({
        ...toXProfileFromCandidate(c),
        samplePosts: getCandidateSampleTexts(c),
        source: c.discoverySource,
      }));

      trace.addStep(await emitStep(progress, {
        id: "insert",
        title: "Spreadsheet Insert",
        summary: `Inserted ${profiles.length} followers into ${project.name}.`,
        status: "success",
        provider,
        bullets: [`Project: ${project.name}`],
        metrics: [{ label: "Inserted", value: profiles.length }],
        tools: [],
      }));

      const leadsList = await addProfilesToProject({
        userId,
        projectId: project.id,
        profiles,
        discoverySource: "followers",
        discoveryQuery: input.query,
      });

      const finalTrace = trace.build(
        `Added ${leadsList.length} followers of @${seedHandle} to ${project.name}.`,
        "success",
      );

      await recordProjectRun({
        projectId: project.id,
        operationType: "search",
        requestedProvider: provider,
        discoveryProvider: "multiagent",
        lookupProvider: provider,
        networkProvider: provider,
        tweetsProvider: provider,
        query: input.query,
        seedUsername: seedHandle,
        minFollowers: input.minFollowers,
        targetLeadCount: input.targetLeadCount,
        leadCount: leadsList.length,
        traceData: finalTrace,
        status: "completed",
      });

      return {
        leads: leadsList,
        project: {
          ...project,
          sourceProviders: dedupeProviders([...project.sourceProviders, provider]),
        },
        trace: finalTrace,
      };
    }

    // ── Lead Memory: Search TurboPuffer (warm → cold) ────────────────────────
    // No seed handle — search our general lead databases.
    try {
      const memoryHits = await searchLeadMemory(userId, input.query, {
        topK: Math.max(targetLeadCount, 50),
        minFollowers: minFollowers,
      });

      if (memoryHits.length > 0) {
        const memoryCandidates = memoryHits.map((hit) => mapMemoryHitToCandidate(hit, input.query));
        for (const c of memoryCandidates) {
          const key = c.account.handle.replace(/^@/, "").toLowerCase();
          knownHandles.add(key);
        }
        screenedCandidates = memoryCandidates;

        trace.addStep(await emitStep(progress, {
          id: "lead-memory",
          title: "Lead Memory Lookup",
          summary: `Found ${memoryHits.length} leads from our database.`,
          status: "success",
          provider: "multiagent",
          tools: ["TurboPuffer"],
          bullets: [
            `${memoryHits.length} leads found across warm and cold databases.`,
            screenedCandidates.length >= targetLeadCount
              ? `Target of ~${targetLeadCount} met from database alone.`
              : enableWebSearch
                ? `${targetLeadCount - screenedCandidates.length} more needed — web search will run next.`
                : `${screenedCandidates.length} leads available. Enable web search for more.`,
          ],
          metrics: [
            { label: "Database hits", value: memoryHits.length },
            { label: "Target", value: targetLeadCount },
          ],
        }));
      }
    } catch (error) {
      console.warn("[search][lead-memory] Lookup failed (non-fatal):", error instanceof Error ? error.message : String(error));
    }

    // ── Skip web discovery if not enabled or target already met ──────────────
    const needsWebSearch = enableWebSearch && screenedCandidates.length < targetLeadCount;

    if (!needsWebSearch && screenedCandidates.length > 0) {
      // We have enough from the database — skip straight to insertion
      if (!enableWebSearch) {
        trace.addStep(await emitStep(progress, {
          id: "web-search-skipped",
          title: "Web Search",
          summary: "Web search is disabled. Using database results only.",
          status: "success",
          provider: discoveryProvider.provider,
          bullets: [
            `${screenedCandidates.length} leads from database.`,
            "Enable 'Also search the web for new leads' to find more.",
          ],
          metrics: [
            { label: "From database", value: screenedCandidates.length },
          ],
          tools: [],
        }));
      }
    }

    // ── Discover → Screen → Check → Loop (only if web search enabled) ────────
    const MAX_SEARCH_PASSES = needsWebSearch ? 6 : 0;
    let latestInterpretation: SearchInterpretation | undefined;
    let totalDiscovered = 0;
    let totalScreenedPool = 0;
    /** Collected screening reasons across all passes for inline reasoning persistence */
    const allSelectedReasons = new Map<string, string>();
    /** All raw discovered candidates (before screening) — used for fallback salvage */
    let allDiscoveredCandidates: XLeadCandidate[] = [];

    try {

    for (let pass = 1; pass <= MAX_SEARCH_PASSES; pass++) {
      const remaining = targetLeadCount - screenedCandidates.length;
      // Stop if we've met the soft target
      if (remaining <= 0) break;

      // Scale discovery target: pass 1 = full target, pass 2+ = shortfall
      const passTarget = pass === 1 ? targetLeadCount : Math.max(20, remaining);
      const passParseTarget = pass === 1
        ? parseAccountsTarget
        : Math.max(100, Math.ceil(passTarget * 3));

      const discoveryResult = discoveryProvider.provider === "multiagent"
        ? await discoverCandidatesWithProviderOwnedLoop(
          discoveryProvider,
          input.query,
          seedHandle,
          minFollowers,
          passTarget,
          passParseTarget,
          progressWithPersistence,
          userId,
        )
        : await discoverCandidatesUntilGoal(
          discoveryProvider,
          input.query,
          seedHandle,
          minFollowers,
          passTarget,
          passParseTarget,
          progressWithPersistence,
        );

      if (!latestInterpretation) {
        latestInterpretation = discoveryResult.interpretation;
      }

      // Filter out handles we already found in previous passes
      const newCandidates = discoveryResult.candidates.filter((c) => {
        const key = c.account.handle.replace(/^@/, "").toLowerCase();
        if (knownHandles.has(key)) return false;
        knownHandles.add(key);
        return true;
      });

      totalDiscovered += newCandidates.length;
      allDiscoveredCandidates = [...allDiscoveredCandidates, ...newCandidates];

      trace.addStep(await emitStep(progress, {
        id: `discovery-${pass}`,
        title: pass === 1 ? "Discovery" : `Discovery Pass ${pass}`,
        summary: pass === 1
          ? `Collected ${newCandidates.length} candidate accounts.`
          : `Supplementary pass found ${newCandidates.length} new candidates (needed ~${remaining} more leads).`,
        status: newCandidates.length > 0 ? "success" : "warning",
        provider: discoveryProvider.provider,
        bullets: [
          seedHandle ? `Seed handle: @${seedHandle}` : "No seed handle used.",
          pass > 1 ? `Already have ${screenedCandidates.length} leads from previous passes.` : "",
          describeDiscoveryStopReason(discoveryResult.stopReason),
        ].filter(Boolean),
        metrics: [
          { label: "Lead target (approx)", value: `~${targetLeadCount}` },
          { label: "New candidates", value: newCandidates.length },
          { label: "Attempts", value: `${discoveryResult.attempts} / ${discoveryResult.maxAttempts}` },
          ...(pass > 1 ? [{ label: "Leads so far", value: screenedCandidates.length }] : []),
        ],
        tools: discoveryProvider.provider === "multiagent"
          ? ["OpenAI", "Tavily", "AgentQL", "Grok API"]
          : [],
      }));

      if (newCandidates.length === 0) {
        // No new candidates found — stop searching
        if (pass === 1) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "No relevant X leads found for this query.",
          });
        }
        break;
      }

      // ── SCREEN in the middle — strict on relevance, generous on count ──────
      const screeningPool = buildScreeningPool(
        newCandidates.sort(byRelevanceDesc),
        passTarget,
      );
      totalScreenedPool += screeningPool.length;

      const screeningResult = await screenProfilesForLeadSearchDetailed(
        input.query,
        screeningPool.map(toScreeningCandidate),
        passTarget,
        latestInterpretation,
      );
      const selectedSet = new Set(screeningResult.selectedIds);
      const passScreened = screeningPool.filter((candidate) =>
        selectedSet.has(candidate.account.xUserId ?? candidate.account.handle.replace(/^@/, "").toLowerCase())
        || selectedSet.has(candidate.account.handle.replace(/^@/, "").toLowerCase()),
      );

      // Collect screening reasons across all passes
      for (const [id, reason] of screeningResult.selectedReasons) {
        allSelectedReasons.set(id, reason);
      }

      screenedCandidates = [...screenedCandidates, ...passScreened];

      trace.addStep(await emitStep(progress, {
        id: `screening-${pass}`,
        title: pass === 1 ? "AI Screening" : `AI Screening Pass ${pass}`,
        summary: `Kept ${passScreened.length} relevant leads from ${screeningPool.length} candidates. Total: ${screenedCandidates.length}.`,
        status: screenedCandidates.length >= Math.ceil(targetLeadCount * 0.7) ? "success" : "warning",
        model: process.env.OPENAI_MODEL ?? "gpt-5",
        bullets: [
          ...screeningResult.batchSummaries.map((batch, index) =>
            `Batch ${index + 1}: reviewed ${batch.candidateCount}, kept ${batch.includedCount}${batch.usedFallback ? " using fallback heuristics" : ""}.`,
          ),
          screenedCandidates.length >= targetLeadCount
            ? `Met the approximate target of ~${targetLeadCount}.`
            : `${targetLeadCount - screenedCandidates.length} more leads needed to meet target.`,
        ],
        metrics: [
          { label: "Pool", value: screeningPool.length },
          { label: "Selected", value: passScreened.length },
          { label: "Total leads", value: screenedCandidates.length },
        ],
        tools: ["OpenAI"],
      }));

      // Stop conditions:
      // 1. Hit the soft target — we have enough
      if (screenedCandidates.length >= targetLeadCount) break;
      // 2. Diminishing returns — this pass found almost nothing new
      if (pass >= 2 && passScreened.length < 3) break;
    }

    if (screenedCandidates.length === 0) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: enableWebSearch
          ? "No relevant leads found for this query."
          : "No matching leads found in our database. Try enabling web search to discover new leads.",
      });
    }

    } catch (pipelineError) {
      // ── Fallback salvage: insert whatever we found so far ────────────────
      // If something broke mid-pipeline, we still have candidates. Insert them
      // so the user isn't left empty-handed. Screened leads are preferred, but
      // if screening failed, we fall back to raw discovered candidates.
      const salvageCandidates = screenedCandidates.length > 0
        ? screenedCandidates
        : allDiscoveredCandidates;

      if (salvageCandidates.length > 0) {
        console.warn("[search][salvage] Pipeline error, salvaging", salvageCandidates.length, "candidates");

        try {
          const salvageProfiles = salvageCandidates.map((c) => ({
            ...toXProfileFromCandidate(c),
            samplePosts: getCandidateSampleTexts(c),
            source: c.discoverySource,
          }));

          const salvageLeads = await addProfilesToProject({
            userId,
            projectId: project.id,
            profiles: salvageProfiles,
            discoverySource: "profile_search",
            discoveryQuery: input.query,
          });


          trace.addStep(await emitStep(progress, {
            id: "salvage",
            title: "Partial Results Saved",
            summary: `An error occurred mid-pipeline. We saved ${salvageLeads.length} leads that were already found.`,
            status: "warning",
            provider: discoveryProvider.provider,
            bullets: [
              "Sorry, something went wrong during the search pipeline.",
              `We saved ${salvageLeads.length} leads we had already found/parsed into your campaign.`,
              "These results may be less filtered than usual, but they're still real accounts matching your query.",
              "You can run the search again to find more leads.",
            ],
            metrics: [
              { label: "Salvaged leads", value: salvageLeads.length },
              { label: "Screened", value: screenedCandidates.length },
              { label: "Raw discovered", value: allDiscoveredCandidates.length },
            ],
            tools: [],
          }));

          const finalTrace = trace.build(
            `Partial results: saved ${salvageLeads.length} leads after a pipeline error.`,
            "warning",
          );

          await recordProjectRun({
            projectId: project.id,
            operationType: "search",
            requestedProvider: provider,
            discoveryProvider: discoveryProvider.provider,
            lookupProvider: provider,
            networkProvider: provider,
            tweetsProvider: provider,
            query: input.query,
            seedUsername: input.followerUsername?.replace(/^@/, ""),
            minFollowers: input.minFollowers,
            targetLeadCount: input.targetLeadCount,
            leadCount: salvageLeads.length,
            traceData: finalTrace,
            status: "partial",
          });

          return {
            leads: salvageLeads,
            project: {
              ...project,
              sourceProviders: dedupeProviders([...project.sourceProviders, provider]),
            },
            trace: finalTrace,
          };
        } catch (salvageError) {
          console.error("[search][salvage] Failed to save partial results:", salvageError);
        }
      }

      // If salvage also failed or there were no candidates, rethrow
      throw pipelineError;
    }

    const finalCandidates = screenedCandidates;

    // Skip canonicalization for DB-only searches — TurboPuffer data is already complete.
    // Only canonicalize when web search ran (candidates need real follower counts).
    const { profiles: rawProfiles, resolution: lookupResolution } = needsWebSearch
      ? await canonicalizeCandidates(provider, finalCandidates)
      : {
        profiles: finalCandidates.map((c) => ({
          ...toXProfileFromCandidate(c),
          samplePosts: getCandidateSampleTexts(c),
          source: c.discoverySource,
        })),
        resolution: {
          requestedProvider: provider,
          effectiveProvider: provider,
          capability: "lookup" as const,
          usedFallback: false,
        },
      };

    // ── Strict minFollowers enforcement after canonicalization ──────────────
    // Canonicalization resolves real follower counts. Drop any leads that
    // don't meet the user's minimum — no exceptions.
    const profiles = minFollowers > 0
      ? rawProfiles.filter((p) => p.followersCount >= minFollowers)
      : rawProfiles;

    if (profiles.length < rawProfiles.length) {
      console.log("[search][follower-filter] Dropped", rawProfiles.length - profiles.length,
        "leads below minFollowers", minFollowers);
    }

    trace.addStep(await emitStep(progress, {
      id: "canonicalization",
      title: "Canonicalization",
      summary: `Prepared ${profiles.length} lead rows for insertion${profiles.length < rawProfiles.length ? ` (${rawProfiles.length - profiles.length} dropped below ${minFollowers} followers)` : ""}.`,
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
      tools: needsWebSearch && lookupResolution.effectiveProvider === "multiagent" ? ["AgentQL"] : [],
    }));
    const leadsList = await addProfilesToProject({
      userId,
      projectId: project.id,
      profiles,
      discoverySource: input.followerUsername ? "followers" : "profile_search",
      discoveryQuery: input.query,
    });

    // Persist screening reasons as inline reasoning — generated DURING search, not after
    if (allSelectedReasons.size > 0 && leadsList.length > 0) {
      try {
        const now = new Date();
        const insightRows = leadsList
          .map((lead) => {
            const reason = allSelectedReasons.get(lead.xUserId ?? "")
              ?? allSelectedReasons.get(lead.handle.replace(/^@/, "").toLowerCase());
            if (!reason) return null;
            return {
              projectId: project.id,
              leadId: lead.id,
              contextHash: `screening:${Date.now()}`,
              summary: reason,
              alignmentBullets: [reason],
              userGoals: [`Search: "${input.query}"`],
              confidence: 70,
              tools: ["OpenAI", "Tavily", "AgentQL"],
              subagents: ["goal_interpreter", "dork_planner", "source_researcher", "candidate_scorer"],
              evidence: [],
              generatedAt: now,
              updatedAt: now,
            };
          })
          .filter((row): row is NonNullable<typeof row> => row !== null);

        if (insightRows.length > 0) {
          await db
            .insert(projectLeadInsights)
            .values(insightRows)
            .onConflictDoUpdate({
              target: [projectLeadInsights.projectId, projectLeadInsights.leadId],
              set: {
                summary: sql`excluded.summary`,
                alignmentBullets: sql`excluded.alignment_bullets`,
                userGoals: sql`excluded.user_goals`,
                confidence: sql`excluded.confidence`,
                tools: sql`excluded.tools`,
                subagents: sql`excluded.subagents`,
                evidence: sql`excluded.evidence`,
                contextHash: sql`excluded.context_hash`,
                updatedAt: sql`excluded.updated_at`,
              },
            });
        }
      } catch (error) {
        console.warn("[search] failed to persist inline screening reasons", error);
      }
    }

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
      tools: [],
    }));

    const operationProviders = resolveSearchOperationProviders(provider, lookupResolution.effectiveProvider);

    const projectWithProviders = {
      ...project,
      sourceProviders: dedupeProviders([...project.sourceProviders, provider]),
    };
    const hitLeadTarget = leadsList.length >= targetLeadCount;
    const finalTrace = trace.build(
      hitLeadTarget
        ? `Added ${leadsList.length} leads to ${project.name}.`
        : `Added ${leadsList.length} leads to ${project.name} against a target of ~${targetLeadCount}.`,
      hitLeadTarget ? "success" : "warning",
    );

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
      minFollowers: input.minFollowers,
      targetLeadCount: input.targetLeadCount,
      leadCount: leadsList.length,
      traceData: finalTrace,
      status: hitLeadTarget ? "completed" : "partial",
    });

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
      query: `${cleanHandle} leads`,
      projectId: input.projectId,
      projectName: input.projectName || `${cleanHandle} leads`,
      followerUsername: cleanHandle,
    });

    const candidates = new Map<string, CanonicalCandidate>();
    let nextFollowers: string | undefined;
    let fetched = 0;

    // Only import the user's verified followers — not accounts they follow
    while (fetched < NETWORK_TARGET) {
      const followersPage = await network.client.getFollowersPage({
        userId: seed.xUserId,
        username: seed.username,
        paginationToken: nextFollowers,
        maxResults: X_PROVIDER_NETWORK_PAGE_SIZE,
      });

      for (const profile of followersPage.profiles) {
        if (!profile.verified) continue;
        candidates.set(profile.username.toLowerCase(), { ...profile, samplePosts: [], source: "followers" });
      }

      fetched += followersPage.profiles.length;
      nextFollowers = followersPage.nextToken;

      if (!nextFollowers || followersPage.profiles.length === 0) {
        break;
      }
    }

    trace.addStep({
      title: "Network Sweep",
      summary: `Collected ${candidates.size} verified followers of @${cleanHandle}.`,
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
      query: `${cleanHandle} leads`,
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
