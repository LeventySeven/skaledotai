import type { ProjectRunTraceStep } from "@/lib/validations/project-runs";
import type { SearchRunGraphNode, SearchRunStreamSnapshot } from "@/lib/validations/search";
import type { XLeadCandidate } from "./types";
import {
  MULTIAGENT_NODE_TITLES,
  MULTIAGENT_MAX_QUERIES,
  type MultiAgentNodeName,
  type MultiAgentSubagentName,
  type MultiAgentRecoveryState,
  type MultiAgentStopReason,
  type ScoredCandidate,
  type ScrapedPayload,
  type MultiAgentErrorRecord,
} from "./multiagent-types";

function isMultiAgentNodeName(value: string): value is MultiAgentNodeName {
  return value in MULTIAGENT_NODE_TITLES;
}

function formatRecoveryState(value: MultiAgentRecoveryState | undefined): string {
  if (!value) return "steady_state";
  return value.replace(/_/g, " ");
}

function formatStopReason(value: MultiAgentStopReason | undefined): string {
  if (!value) return "continue";
  return value.replace(/_/g, " ");
}

function buildGraphNodes(
  activeNode: MultiAgentNodeName | undefined,
  completedNodes: MultiAgentNodeName[],
): SearchRunGraphNode[] {
  return (Object.entries(MULTIAGENT_NODE_TITLES) as Array<[MultiAgentNodeName, string]>).map(([id, title]) => ({
    id,
    title,
    status:
      activeNode === id ? "active"
      : completedNodes.includes(id) ? "complete"
      : "idle",
  }));
}

export type MultiAgentStateSnapshot = {
  targetLeadCount?: number;
  goalCount?: number;
  attempt?: number;
  maxAttempts?: number;
  activeNode?: MultiAgentNodeName;
  activeSubagent?: MultiAgentSubagentName | string;
  completedNodes?: MultiAgentNodeName[];
  recoveryState?: MultiAgentRecoveryState;
  stopReason?: MultiAgentStopReason;
  firstPassCount?: number;
  queries?: string[];
  plannedQueries?: string[];
  currentQueries?: string[];
  urls?: string[];
  candidateUrls?: string[];
  scraped?: Array<ScrapedPayload | unknown>;
  candidates?: XLeadCandidate[];
  scored?: ScoredCandidate[];
  plannerFallbackUsed?: boolean;
  userGoals?: string[];
  geoHints?: string[];
  /** Planner-interpreted search context — NOT streamed to client, used internally */
  roleTerms?: string[];
  bioTerms?: string[];
  antiGoals?: string[];
  traceQuery?: string;
  traceBatchUrls?: string[];
  recoveryNote?: string;
  errors?: MultiAgentErrorRecord[];
  lastAttemptYield?: number;
  hydratedCount?: number;
  hydrationTools?: string[];
};

export { isMultiAgentNodeName };

function resolveNodeTools(
  nodeName: MultiAgentNodeName,
  update: MultiAgentStateSnapshot,
): string[] {
  if (nodeName === "planner") {
    return update.plannerFallbackUsed ? ["OpenAI", "Heuristic query fallback"] : ["OpenAI"];
  }

  if (nodeName === "people_search") {
    return ["AgentQL", "TwitterAPI.io"];
  }

  if (nodeName === "grok_search") {
    return ["Grok API"];
  }

  if (nodeName === "source_fanout") {
    return ["Tavily"];
  }

  if (nodeName === "scraper") {
    return ["AgentQL"];
  }

  if (nodeName === "scorer" && update.hydrationTools && update.hydrationTools.length > 0) {
    return update.hydrationTools;
  }

  return [];
}

export function toMultiAgentStreamSnapshot(state: MultiAgentStateSnapshot): SearchRunStreamSnapshot {
  const activeNode = state.activeNode && isMultiAgentNodeName(state.activeNode)
    ? state.activeNode
    : undefined;
  const plannedQueries = state.plannedQueries ?? state.queries ?? [];
  const candidateUrls = state.candidateUrls ?? state.urls ?? [];
  const scrapedCount = state.scraped?.length ?? 0;

  return {
    queries: plannedQueries.length,
    urls: candidateUrls.length,
    scraped: scrapedCount,
    candidates: state.candidates?.length ?? 0,
    targetLeadCount: state.targetLeadCount ?? 1,
    goalCount: state.goalCount ?? state.targetLeadCount ?? 1,
    attempt: state.attempt ?? 1,
    maxAttempts: state.maxAttempts ?? 1,
    activeNode,
    activeSubagent: state.activeSubagent,
    recoveryState: state.recoveryState,
    stopReason: state.stopReason,
    firstPassCount: state.firstPassCount,
    graphNodes: buildGraphNodes(activeNode, state.completedNodes ?? []),
  };
}

export function buildMultiAgentTraceStep(
  nodeName: MultiAgentNodeName,
  update: MultiAgentStateSnapshot,
  index: number,
  minFollowers: number | undefined,
  plannerModelName: string,
): ProjectRunTraceStep {
  const attemptMetric = update.attempt ? [{ label: "Attempt", value: `${update.attempt}` }] : [];
  const tools = resolveNodeTools(nodeName, update);

  if (nodeName === "planner") {
    const queries = update.currentQueries ?? update.plannedQueries ?? update.queries ?? [];
    const bullets = queries.slice(0, MULTIAGENT_MAX_QUERIES).map((query, queryIndex) => `Query ${queryIndex + 1}: ${query}`);
    if ((update.userGoals?.length ?? 0) > 0) {
      bullets.unshift(`User goals: ${update.userGoals?.slice(0, 2).join(" · ")}`);
    }
    if ((update.geoHints?.length ?? 0) > 0) {
      bullets.unshift(`Geo hints: ${update.geoHints?.slice(0, 2).join(", ")}`);
    }
    if (update.plannerFallbackUsed) {
      bullets.unshift("Planner entered JSON-repair mode and switched to heuristic queries.");
    }

    return {
      id: `multiagent-${index}-${nodeName}`,
      title: MULTIAGENT_NODE_TITLES[nodeName],
      summary: `Prepared ${queries.length} discovery queries for the current supervisor pass.`,
      status: "success",
      subagent: update.activeSubagent,
      provider: "multiagent",
      model: plannerModelName,
      tools,
      bullets,
      metrics: [
        ...attemptMetric,
        { label: "Queries", value: queries.length },
      ],
    };
  }

  if (nodeName === "people_search") {
    const candidates = update.candidates ?? [];
    return {
      id: `multiagent-${index}-${nodeName}`,
      title: MULTIAGENT_NODE_TITLES[nodeName],
      summary: `Found ${candidates.length} candidates via TwitterAPI.io user search and verified followers.`,
      status: candidates.length > 0 ? "success" : "warning",
      subagent: update.activeSubagent,
      provider: "multiagent",
      tools,
      bullets: [
        `Searched role/bio terms via TwitterAPI.io user search.`,
        ...candidates.slice(0, 3).map((c) => `@${c.account.handle}: ${c.account.bio.slice(0, 80)}${c.account.bio.length > 80 ? "..." : ""}`),
      ],
      metrics: [
        ...attemptMetric,
        { label: "Candidates", value: candidates.length },
      ],
    };
  }

  if (nodeName === "grok_search") {
    const candidates = update.candidates ?? [];
    return {
      id: `multiagent-${index}-${nodeName}`,
      title: MULTIAGENT_NODE_TITLES[nodeName],
      summary: `Found ${candidates.length} candidates via Grok X-Search.`,
      status: candidates.length > 0 ? "success" : "warning",
      subagent: update.activeSubagent,
      provider: "multiagent",
      tools,
      bullets: [
        `Searched X via Grok API x_search tool.`,
        ...candidates.slice(0, 3).map((c) => `@${c.account.handle}: ${c.account.bio.slice(0, 80)}${c.account.bio.length > 80 ? "..." : ""}`),
      ],
      metrics: [
        ...attemptMetric,
        { label: "Candidates", value: candidates.length },
      ],
    };
  }

  if (nodeName === "source_fanout") {
    const urls = update.candidateUrls ?? [];
    const bullets = [
      update.traceQuery ? `Search query: ${update.traceQuery}` : undefined,
      ...urls.slice(0, 3),
    ].filter((item): item is string => Boolean(item));

    return {
      id: `multiagent-${index}-${nodeName}`,
      title: MULTIAGENT_NODE_TITLES[nodeName],
      summary: `Resolved ${urls.length} candidate X profile URLs from one discovery branch.`,
      status: "success",
      subagent: update.activeSubagent,
      provider: "multiagent",
      tools,
      bullets,
      metrics: [
        ...attemptMetric,
        { label: "URLs", value: urls.length },
      ],
    };
  }

  if (nodeName === "scraper") {
    const payloads = update.scraped ?? [];
    const batchUrls = update.traceBatchUrls ?? [];
    const failures = update.errors?.length ?? 0;

    return {
      id: `multiagent-${index}-${nodeName}`,
      title: MULTIAGENT_NODE_TITLES[nodeName],
      summary: `Scraped ${payloads.length} payloads from ${batchUrls.length || payloads.length} routed URLs.`,
      status: failures > 0 ? "warning" : "success",
      subagent: update.activeSubagent,
      provider: "multiagent",
      tools,
      bullets: [
        batchUrls.length > 0 ? `Batch: ${batchUrls.join(", ")}` : "Batch completed.",
        failures > 0 ? `${failures} URLs were handed to recovery after scrape failures.` : "No scrape failures in this batch.",
      ],
      metrics: [
        ...attemptMetric,
        { label: "Payloads", value: payloads.length },
        { label: "Failures", value: failures },
      ],
    };
  }

  if (nodeName === "scorer") {
    const scored = update.scored ?? [];
    return {
      id: `multiagent-${index}-${nodeName}`,
      title: MULTIAGENT_NODE_TITLES[nodeName],
      summary: `Scored ${scored.length} candidate accounts for relevance, authenticity, and quality.`,
      status: "success",
      subagent: update.activeSubagent,
      provider: "multiagent",
      tools,
      bullets: [
        update.hydratedCount && update.hydratedCount > 0
          ? `Profile hydrator enriched ${update.hydratedCount} candidates with canonical bio/location data.`
          : "No additional profile hydration was applied before scoring.",
        ...scored.slice(0, 3).map((item) =>
          `${item.candidate.account.handle}: ${item.score}/100${item.reasons[0] ? ` · ${item.reasons[0]}` : ""}`,
        ),
      ],
      metrics: [
        ...attemptMetric,
        { label: "Scored", value: scored.length },
        { label: "Hydrated", value: update.hydratedCount ?? 0 },
      ],
    };
  }

  if (nodeName === "validator") {
    const candidates = update.candidates ?? [];
    return {
      id: `multiagent-${index}-${nodeName}`,
      title: MULTIAGENT_NODE_TITLES[nodeName],
      summary: `Validator kept ${candidates.length} candidates and routed the graph via ${formatStopReason(update.stopReason)}.`,
      status: update.stopReason === "goal_reached" ? "success" : update.recoveryState ? "warning" : "success",
      subagent: update.activeSubagent,
      provider: "multiagent",
      tools,
      bullets: [
        update.stopReason === "goal_reached"
          ? "Target candidate goal reached, so the graph terminated proactively."
          : update.recoveryState
            ? `Recovery handoff: ${formatRecoveryState(update.recoveryState)}.`
            : "Validator held the current candidate pool steady.",
        minFollowers && minFollowers > 0
          ? `Minimum follower floor: ${minFollowers}+`
          : "No minimum follower floor applied inside validation.",
      ],
      metrics: [
        ...attemptMetric,
        { label: "Candidates", value: candidates.length },
        { label: "Yield", value: update.lastAttemptYield ?? 0 },
      ],
    };
  }

  return {
    id: `multiagent-${index}-${nodeName}`,
    title: MULTIAGENT_NODE_TITLES[nodeName],
    summary: `Recovery prepared the next attempt using ${formatRecoveryState(update.recoveryState)} safeguards.`,
    status: "warning",
    subagent: update.activeSubagent,
    provider: "multiagent",
    tools,
    bullets: [
      update.recoveryNote ?? "The supervisor lowered risk and prepared a bounded retry.",
    ],
    metrics: [
      ...attemptMetric,
      { label: "Next batch", value: update.traceBatchUrls?.length ?? 0 },
    ],
  };
}
