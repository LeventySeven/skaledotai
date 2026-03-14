import {
  XDataProviderSchema,
  type XDataProvider,
} from "@/lib/validations/x-provider";
export { XDataProviderSchema, type XDataProvider };

export type XProviderCapability = "discovery" | "lookup" | "network" | "tweets";

export type XProviderCapabilities = Record<XProviderCapability, boolean>;

export const DEFAULT_X_DATA_PROVIDER: XDataProvider = "x-api";
export const X_DATA_PROVIDER_STORAGE_KEY = "skaleai.x-data-provider";

export type XDataProviderDocLink = {
  label: string;
  href: string;
};

export type XDataProviderOption = {
  value: XDataProvider;
  label: string;
  badge: string;
  description: string;
  integration: string;
  docs: XDataProviderDocLink[];
  experimental?: boolean;
  capabilities: XProviderCapabilities;
};

export const X_DATA_PROVIDER_SURFACES = [
  "Search",
  "Imports",
  "Stats",
  "AI",
] as const;

export const X_PROVIDER_CAPABILITIES: Record<XDataProvider, XProviderCapabilities> = {
  "x-api": {
    discovery: true,
    lookup: true,
    network: true,
    tweets: true,
  },
  twitterapi: {
    discovery: false,
    lookup: true,
    network: false,
    tweets: false,
  },
  apify: {
    discovery: true,
    lookup: true,
    network: true,
    tweets: true,
  },
  multiagent: {
    discovery: true,
    lookup: true,
    network: false,
    tweets: true,
  },
  openrouter: {
    discovery: true,
    lookup: false,
    network: false,
    tweets: false,
  },
};

export const X_DATA_PROVIDER_OPTIONS: XDataProviderOption[] = [
  {
    value: "x-api",
    label: "X API",
    badge: "Native",
    description: "Direct X API v2 access with the existing bearer token setup.",
    integration: "Native REST endpoints for user search, lookups, follows, and post search.",
    capabilities: X_PROVIDER_CAPABILITIES["x-api"],
    docs: [
      {
        label: "X posts search",
        href: "https://docs.x.com/x-api/posts/search/introduction",
      },
      {
        label: "X user search",
        href: "https://docs.x.com/x-api/users/search/introduction",
      },
      {
        label: "X follows",
        href: "https://docs.x.com/x-api/users/follows/introduction",
      },
    ],
  },
  {
    value: "twitterapi",
    label: "TwitterAPI.io",
    badge: "Lookup",
    description: "Lookup and enrichment provider for X profiles by user ID.",
    integration: "Batch user hydration through TwitterAPI.io with richer profile description and location fields.",
    capabilities: X_PROVIDER_CAPABILITIES.twitterapi,
    docs: [
      {
        label: "Batch user info by ids",
        href: "https://docs.twitterapi.io/api-reference/endpoint/batch_get_user_by_userids",
      },
    ],
  },
  {
    value: "apify",
    label: "Apify",
    badge: "Actors",
    description: "Actor-based scraping for search, profiles, tweets, and network snapshots.",
    integration: "Synchronous Actor runs that return dataset items which Skale normalizes into one adapter.",
    capabilities: X_PROVIDER_CAPABILITIES.apify,
    docs: [
      {
        label: "Actors overview",
        href: "https://docs.apify.com/platform/actors",
      },
      {
        label: "Run sync API",
        href: "https://docs.apify.com/api/v2/act-run-sync-get-dataset-items-post",
      },
      {
        label: "Advanced search actor",
        href: "https://apify.com/api-ninja/x-twitter-advanced-search",
      },
      {
        label: "User scraper actor",
        href: "https://apify.com/apidojo/twitter-user-scraper/input-schema",
      },
    ],
  },
  {
    value: "multiagent",
    label: "Multi-Agent",
    badge: "Experimental",
    description: "LangGraph pipeline that plans discovery, finds X URLs, scrapes profiles, and aggregates candidates.",
    integration: "Bounded LangGraph workflow with Tavily discovery, AgentQL extraction, and GPT-5 orchestration.",
    experimental: true,
    capabilities: X_PROVIDER_CAPABILITIES.multiagent,
    docs: [
      {
        label: "LangGraph JS",
        href: "https://github.com/langchain-ai/langgraphjs",
      },
      {
        label: "LangGraph supervisor",
        href: "https://github.com/langchain-ai/langgraph-supervisor-js",
      },
      {
        label: "Tavily search",
        href: "https://docs.tavily.com/documentation/api-reference/endpoint/search",
      },
      {
        label: "AgentQL query_data",
        href: "https://docs.agentql.com/scraping/scraping-data-sdk",
      },
    ],
  },
  {
    value: "openrouter",
    label: "OpenRouter (Grok 4.1)",
    badge: "Experimental",
    description: "LLM-driven X lead discovery through OpenRouter web search and structured JSON extraction.",
    integration: "OpenRouter web search constrained to X domains, then canonicalized through the shared lookup path.",
    experimental: true,
    capabilities: X_PROVIDER_CAPABILITIES.openrouter,
    docs: [
      {
        label: "Web search plugin",
        href: "https://openrouter.ai/docs/guides/features/plugins/web-search",
      },
      {
        label: "Structured outputs",
        href: "https://openrouter.ai/docs/guides/features/structured-outputs",
      },
    ],
  },
];

export function parseXDataProvider(value: string | null | undefined): XDataProvider {
  const parsed = XDataProviderSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_X_DATA_PROVIDER;
}

export function getXDataProviderLabel(provider: XDataProvider): string {
  return X_DATA_PROVIDER_OPTIONS.find((option) => option.value === provider)?.label ?? "X API";
}

export function getXDataProviderOption(provider: XDataProvider): XDataProviderOption {
  return X_DATA_PROVIDER_OPTIONS.find((option) => option.value === provider) ?? X_DATA_PROVIDER_OPTIONS[0];
}

export function getXProviderCapabilities(provider: XDataProvider): XProviderCapabilities {
  return X_PROVIDER_CAPABILITIES[provider];
}

export function supportsXProviderCapability(
  provider: XDataProvider,
  capability: XProviderCapability,
): boolean {
  return X_PROVIDER_CAPABILITIES[provider][capability];
}

export function isFullXDataProvider(provider: XDataProvider): boolean {
  const capabilities = getXProviderCapabilities(provider);
  return capabilities.discovery && capabilities.lookup && capabilities.network && capabilities.tweets;
}
