// Public surface for all X / Twitter data access.
// App code should import from "@/lib/x", not from individual files.

export type {
  XDataClient,
  XResolvedTweet,
  XProfilesPage,
  XPostSearchResult,
  XTweetMetrics,
  XUserReference,
} from "./types";

export {
  DEFAULT_X_DATA_PROVIDER,
  X_DATA_PROVIDER_STORAGE_KEY,
  X_DATA_PROVIDER_SURFACES,
  X_DATA_PROVIDER_OPTIONS,
  parseXDataProvider,
  getXDataProviderLabel,
  getXDataProviderOption,
} from "./provider";
export type { XDataProvider, XDataProviderOption, XDataProviderDocLink } from "./provider";

// NOTE: getXDataClient and mapTweetsToMetrics are server-only.
// Server code should import them from "@/lib/x/client" directly.

export {
  XApiError,
  buildPostSearchQuery,
  buildReplySearchQuery,
  isUnsupportedAuthenticationError,
} from "./api";
