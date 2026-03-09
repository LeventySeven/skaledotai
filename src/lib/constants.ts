// Search tuning
export const SEARCH_TARGET = 40;
export const NETWORK_TARGET = 1000;

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
