import {
  XDataProviderSchema,
  type XDataProvider,
} from "@/lib/validations/x-provider";
export { XDataProviderSchema, type XDataProvider };

export type XProviderCapability = "discovery" | "lookup" | "network" | "tweets";

export type XProviderCapabilities = Record<XProviderCapability, boolean>;

export const DEFAULT_X_DATA_PROVIDER: XDataProvider = "multiagent";
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
    network: true,
    tweets: false,
  },
  multiagent: {
    discovery: true,
    lookup: true,
    network: false,
    tweets: true,
  },
};

/**
 * Only providers shown in the Settings UI selector.
 * x-api is intentionally excluded — the app uses the agentic provider for search/discovery.
 * x-api is still used internally (DMs, user lookups, etc).
 */
export const X_DATA_PROVIDER_OPTIONS: XDataProviderOption[] = [
  {
    value: "multiagent",
    label: "Agentic",
    badge: "Default",
    description: "LangGraph pipeline that plans discovery, finds X URLs, scrapes profiles, and aggregates candidates.",
    integration: "Bounded LangGraph workflow with Tavily discovery, AgentQL extraction, and GPT-5 orchestration.",
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
