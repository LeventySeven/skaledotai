import {
  XDataProviderSchema,
  type XDataProvider,
} from "@/lib/validations/x-provider";

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
};

export const X_DATA_PROVIDER_SURFACES = [
  "Search",
  "Imports",
  "Stats",
  "AI",
] as const;

export const X_DATA_PROVIDER_OPTIONS: XDataProviderOption[] = [
  {
    value: "x-api",
    label: "X API",
    badge: "Native",
    description: "Direct X API v2 access with the existing bearer token setup.",
    integration: "Native REST endpoints for user search, lookups, follows, and post search.",
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
    value: "apify",
    label: "Apify",
    badge: "Actors",
    description: "Actor-based scraping for search, profiles, tweets, and network snapshots.",
    integration: "Synchronous Actor runs that return dataset items which Skale normalizes into one adapter.",
    docs: [
      {
        label: "Actors overview",
        href: "https://docs.apify.com/platform/actors",
      },
      {
        label: "Run sync API",
        href: "https://docs.apify.com/api/v2/act-run-sync-get-dataset-items-post",
      },
    ],
  },
  {
    value: "phantombuster",
    label: "PhantomBuster",
    badge: "Agents",
    description: "Agent-based scraping for profiles, searches, and follower graphs.",
    integration: "Agent launches plus container polling, then result ingestion from PhantomBuster storage.",
    docs: [
      {
        label: "API overview",
        href: "https://hub.phantombuster.com/reference/introduction",
      },
      {
        label: "Launch agents",
        href: "https://hub.phantombuster.com/reference/post_api-v2-agents-launch",
      },
      {
        label: "Fetch containers",
        href: "https://hub.phantombuster.com/reference/get_api-v2-containers-fetch",
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

export { XDataProviderSchema };
export type { XDataProvider };
