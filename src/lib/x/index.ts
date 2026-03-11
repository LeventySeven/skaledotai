// Public surface for all X / Twitter data access.
// App code should import from "@/lib/x", not from individual files.

export type {
  XDataClient,
  XDiscoveryInput,
  XDiscoveryProvider,
  XLeadCandidate,
  XLeadCandidatePost,
  InfluencerScore,
  XResolvedTweet,
  XProfilesPage,
  XPostSearchResult,
  XTweetMetrics,
  XUserReference,
} from "./types";
export { XProviderRuntimeError } from "./types";

export {
  DEFAULT_X_DATA_PROVIDER,
  X_DATA_PROVIDER_STORAGE_KEY,
  X_DATA_PROVIDER_SURFACES,
  X_DATA_PROVIDER_OPTIONS,
  X_PROVIDER_CAPABILITIES,
  XDataProviderSchema,
  parseXDataProvider,
  getXDataProviderLabel,
  getXDataProviderOption,
  getXProviderCapabilities,
  supportsXProviderCapability,
  isFullXDataProvider,
} from "./provider";
export type {
  XDataProvider,
  XDataProviderOption,
  XDataProviderDocLink,
  XProviderCapability,
  XProviderCapabilities,
} from "./provider";

// NOTE: getXDataClient and mapTweetsToMetrics are server-only.
// Server code should import them from "@/lib/x/registry" directly.

export {
  buildPostSearchQuery,
  buildReplySearchQuery,
  isUnsupportedAuthenticationError,
} from "./api";
