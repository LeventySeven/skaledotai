import type { ProjectRunTraceStep } from "@/lib/validations/project-runs";
import type { SearchRunGraphNode, SearchRunStreamSnapshot } from "@/lib/validations/search";
import type { XLeadCandidate } from "./types";
import {
  MULTIAGENT_NODE_TITLES,
  MULTIAGENT_MAX_QUERIES,
  type MultiAgentNodeName,
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
  traceQuery?: string;
  traceBatchUrls?: string[];
  recoveryNote?: string;
  errors?: MultiAgentErrorRecord[];
  lastAttemptYield?: number;
};

export { isMultiAgentNodeName };

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

  if (nodeName === "planner") {
    const queries = update.currentQueries ?? update.plannedQueries ?? update.queries ?? [];
    const bullets = queries.slice(0, MULTIAGENT_MAX_QUERIES).map((query, queryIndex) => `Query ${queryIndex + 1}: ${query}`);
    if (update.plannerFallbackUsed) {
      bullets.unshift("Planner entered JSON-repair mode and switched to heuristic queries.");
    }

    return {
      id: `multiagent-${index}-${nodeName}`,
      title: MULTIAGENT_NODE_TITLES[nodeName],
      summary: `Prepared ${queries.length} discovery queries for the current supervisor pass.`,
      status: "success",
      provider: "multiagent",
      model: plannerModelName,
      bullets,
      metrics: [
        ...attemptMetric,
        { label: "Queries", value: queries.length },
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
      provider: "multiagent",
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
      provider: "multiagent",
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
      provider: "multiagent",
      bullets: scored.slice(0, 3).map((item) =>
        `${item.candidate.account.handle}: ${item.score}/100${item.reasons[0] ? ` · ${item.reasons[0]}` : ""}`,
      ),
      metrics: [
        ...attemptMetric,
        { label: "Scored", value: scored.length },
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
      provider: "multiagent",
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
    provider: "multiagent",
    bullets: [
      update.recoveryNote ?? "The supervisor lowered risk and prepared a bounded retry.",
    ],
    metrics: [
      ...attemptMetric,
      { label: "Next batch", value: update.traceBatchUrls?.length ?? 0 },
    ],
  };
}
