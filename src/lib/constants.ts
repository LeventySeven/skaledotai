// Search tuning
export const SEARCH_TARGET = 40;
export const NETWORK_TARGET = 1000;
export const X_PROVIDER_SEARCH_USERS_LIMIT = 25;
export const X_PROVIDER_POST_SEARCH_LIMIT = 50;
export const X_PROVIDER_NETWORK_PAGE_SIZE = 250;
export const X_PROVIDER_STATS_TWEET_LIMIT = 30;
export const X_PROVIDER_ANALYSIS_TWEET_LIMIT = 12;
export const X_PROVIDER_THIRD_PARTY_DEFAULT_NETWORK_LIMIT = 100;
export const X_PROVIDER_THIRD_PARTY_MIN_RESULTS = 10;
export const X_PROVIDER_THIRD_PARTY_SEARCH_EXPANSION_FACTOR = 3;
export const X_PROVIDER_RETRY_COUNT = 3;
export const X_PROVIDER_RETRY_BASE_DELAY_MS = 1000;
export const PHANTOMBUSTER_POLL_INTERVAL_MS = 10_000;

// Analysis tuning
export const ANALYSIS_SHORTLIST_SIZE = 18;
export const ANALYSIS_AI_FALLBACK_SIZE = 8;
export const ANALYSIS_OUTREACH_CANDIDATES = 12;

// UI
export const PROJECT_PREVIEW_LEAD_COUNT = 4;

// Pagination
export const DEFAULT_PAGE_SIZE = 10;

// AI config
export const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5";
export const DEFAULT_OPENAI_REASONING_EFFORT =
  process.env.OPENAI_REASONING_EFFORT ?? "medium";

// Storage keys
export const GENERATED_TEMPLATES_STORAGE_KEY =
  "skaleai-generated-outreach-templates";
