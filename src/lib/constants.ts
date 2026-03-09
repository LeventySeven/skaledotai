// Search tuning
export const SEARCH_TARGET = 40;
export const NETWORK_TARGET = 1000;

// Pagination
export const DEFAULT_PAGE_SIZE = 10;

// AI config
export const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5";
export const DEFAULT_OPENAI_REASONING_EFFORT =
  process.env.OPENAI_REASONING_EFFORT ?? "medium";

// Storage keys
export const GENERATED_TEMPLATES_STORAGE_KEY =
  "skaleai-generated-outreach-templates";
