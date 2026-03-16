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
  // Prefer candidates with posts (active niche participation) over those with just a profile
  const postDiff = b.posts.length - a.posts.length;
  if (postDiff !== 0) return postDiff;
  // Then prefer candidates with longer bios (more identity signal)
  const bioDiff = b.account.bio.length - a.account.bio.length;
  return bioDiff;
  // NOTE: follower count is intentionally NOT used as a tiebreaker — it biases toward
  // high-follower accounts that are often irrelevant (CEOs, companies, influencers).
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
  // Send ALL discovered candidates to AI screening — more relevant leads = better.
  // The AI screener will reject irrelevant ones. No artificial pre-screening cap.
  const seen = new Set<string>();
  const pool: XLeadCandidate[] = [];

  function push(candidate: XLeadCandidate): void {
    const key = candidate.account.handle.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    pool.push(candidate);
  }

  // Priority 1: candidates with posts (evidence of active niche participation)
  for (const candidate of candidates.filter((candidate) => candidate.posts.length > 0)) push(candidate);
  // Priority 2: candidates with substantive bios (identity signal)
  for (const candidate of candidates.filter((candidate) => candidate.account.bio.trim().length >= 30)) push(candidate);
  // Priority 3: reply/profile search sources (direct niche discovery)
  for (const candidate of candidates.filter((candidate) => candidate.discoverySource === "profile_search" || candidate.discoverySource === "reply_search")) {
    push(candidate);
  }
  // Priority 4: all remaining candidates
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

    combinedCandidates = dedupeCandidates(
      [...combinedCandidates, ...attemptCandidates]
        .filter((candidate) => candidate.account.followers >= minFollowers),
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
    const discoveryResult = discoveryProvider.provider === "multiagent"
      ? await discoverCandidatesWithProviderOwnedLoop(
        discoveryProvider,
        input.query,
        seedHandle,
        minFollowers,
        targetLeadCount,
        parseAccountsTarget,
        progress,
      )
      : await discoverCandidatesUntilGoal(
        discoveryProvider,
        input.query,
        seedHandle,
        minFollowers,
        targetLeadCount,
        parseAccountsTarget,
        progress,
      );
    const discoveredCandidates = discoveryResult.candidates;

    trace.addStep(await emitStep(progress, {
      id: "discovery-summary",
      title: "Discovery",
      summary: discoveryResult.satisfied
        ? `Collected ${discoveredCandidates.length} candidate accounts and hit the bounded discovery goal.`
        : `Collected ${discoveredCandidates.length} candidate accounts before the bounded search window closed.`,
      status: discoveryResult.satisfied ? "success" : "warning",
      provider: discoveryProvider.provider,
      bullets: [
        seedHandle ? `Seed handle: @${seedHandle}` : "No seed handle used.",
        discoveryProvider.provider === "multiagent"
          ? (discoveryResult.recoveryState
            ? describeDiscoveryRecoveryState(discoveryResult.recoveryState)
            : discoveryResult.attempts > 1
              ? "The provider-owned graph completed multiple bounded passes without surfacing a recovery lane in the final state."
              : "The provider-owned graph completed on its first bounded pass.")
          : (discoveryResult.retryQueries.length > 0
            ? `Expanded into ${discoveryResult.retryQueries.length} additional discovery queries after the first pass came back light.`
            : "No additional discovery queries were required."),
        describeDiscoveryStopReason(discoveryResult.stopReason),
      ],
      metrics: [
        { label: "Lead target (approx)", value: `~${targetLeadCount}` },
        { label: "Candidate goal", value: discoveryResult.goalCount },
        { label: "Attempts", value: `${discoveryResult.attempts} / ${discoveryResult.maxAttempts}` },
        { label: "Parse pool", value: parseAccountsTarget },
        { label: "First pass", value: discoveryResult.firstPassCount },
        { label: "Final candidates", value: discoveredCandidates.length },
      ],
      tools: discoveryProvider.provider === "multiagent"
        ? ["OpenAI", "Tavily", "AgentQL"]
        : [],
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
      discoveredCandidates.sort(byRelevanceDesc),
      targetLeadCount,
    );

    const screeningResult = await screenProfilesForLeadSearchDetailed(
      input.query,
      screeningPool.map(toScreeningCandidate),
      targetLeadCount,
      discoveryResult.interpretation,
    );
    const selectedSet = new Set(screeningResult.selectedIds);
    const screenedCandidates = screeningPool.filter((candidate) =>
      selectedSet.has(candidate.account.xUserId ?? candidate.account.handle.replace(/^@/, "").toLowerCase())
      || selectedSet.has(candidate.account.handle.replace(/^@/, "").toLowerCase()),
    );

    trace.addStep(await emitStep(progress, {
      id: "screening",
      title: "AI Screening",
      summary: `The model kept ${screenedCandidates.length} leads from a pool of ${screeningPool.length}.`,
      status: screenedCandidates.length >= Math.ceil(targetLeadCount * 0.8) ? "success" : "warning",
      model: process.env.OPENAI_MODEL ?? "gpt-5",
      bullets: [
        ...screeningResult.batchSummaries.map((batch, index) =>
          `Batch ${index + 1}: reviewed ${batch.candidateCount}, kept ${batch.includedCount}${batch.usedFallback ? " using fallback heuristics" : ""}.`,
        ),
      ],
      metrics: [
        { label: "Pool", value: screeningPool.length },
        { label: "Selected", value: screenedCandidates.length },
      ],
      tools: ["OpenAI"],
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
      tools: lookupResolution.effectiveProvider === "multiagent" ? ["AgentQL"] : [],
    }));
    const leadsList = await addProfilesToProject({
      userId,
      projectId: project.id,
      profiles,
      discoverySource: input.followerUsername ? "followers" : "profile_search",
      discoveryQuery: input.query,
    });

    // Persist screening reasons as inline reasoning — generated DURING search, not after
    if (screeningResult.selectedReasons.size > 0 && leadsList.length > 0) {
      try {
        const now = new Date();
        const insightRows = leadsList
          .map((lead) => {
            const reason = screeningResult.selectedReasons.get(lead.xUserId ?? "")
              ?? screeningResult.selectedReasons.get(lead.handle.replace(/^@/, "").toLowerCase());
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
    });

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
