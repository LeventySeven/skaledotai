import type { XLeadCandidate } from "./types";
import type { XProviderRuntimeError } from "./types";

export const MULTIAGENT_NODE_TITLES = {
  planner: "Planner",
  source_fanout: "Source Fanout",
  scraper: "Scraper",
  scorer: "Scorer",
  validator: "Validator",
  recovery: "Recovery",
} as const;

export const MULTIAGENT_SUBAGENT_TITLES = {
  goal_interpreter: "Goal Interpreter",
  dork_planner: "Dork Planner",
  source_researcher: "Source Researcher",
  profile_hydrator: "Profile Hydrator",
  candidate_scorer: "Candidate Scorer",
  validator: "Validator",
  recovery: "Recovery",
} as const;

export const MULTIAGENT_MAX_QUERIES = 5;

export type MultiAgentNodeName = keyof typeof MULTIAGENT_NODE_TITLES;
export type MultiAgentSubagentName = keyof typeof MULTIAGENT_SUBAGENT_TITLES;
export type MultiAgentRecoveryState = "low_yield" | "rate_limited" | "json_repair";
export type MultiAgentStopReason = "goal_reached" | "max_attempts" | "query_exhausted";
export type MultiAgentPlannerMode = "initial" | "expansion" | "repair" | "throttle";

export type MultiAgentErrorRecord = {
  stage: "planner" | "source_fanout" | "scraper";
  attempt: number;
  code: XProviderRuntimeError["code"];
  message: string;
  query?: string;
  url?: string;
};

export type ScrapedPayload = {
  url: string;
  payload: unknown;
};

export type ScoredCandidate = {
  candidate: XLeadCandidate;
  score: number;
  reasons: string[];
  attempt: number;
};

export type PlannerResult = {
  queries: string[];
  plannerMode: MultiAgentPlannerMode;
  usedFallback: boolean;
  userGoals: string[];
  geoHints: string[];
  antiGoals: string[];
  plannerError?: MultiAgentErrorRecord;
};

export type PlannerAgentInput = {
  attempt: number;
  currentQueries: string[];
  goalCount: number;
  limit: number;
  maxAttempts: number;
  niche: string;
  plannedQueries: string[];
  queryBudget: number;
  recoveryState?: MultiAgentRecoveryState;
  seedHandle?: string;
  targetLeadCount: number;
};

export type SourceFanoutAgentInput = {
  attempt: number;
  goalCount: number;
  limit: number;
  query: string;
};

export type ScraperAgentInput = {
  attempt: number;
  urls: string[];
};
