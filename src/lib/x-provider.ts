import {
  XDataProviderSchema,
  type XDataProvider,
} from "@/lib/validations/x-provider";

export const DEFAULT_X_DATA_PROVIDER: XDataProvider = "x-api";
export const X_DATA_PROVIDER_STORAGE_KEY = "skaleai.x-data-provider";

export const X_DATA_PROVIDER_OPTIONS: Array<{
  value: XDataProvider;
  label: string;
  description: string;
}> = [
  {
    value: "x-api",
    label: "X API",
    description: "Native API access with the existing bearer token setup.",
  },
  {
    value: "apify",
    label: "Apify",
    description: "Actor-based scraping for search, profiles, tweets, and networks.",
  },
  {
    value: "phantombuster",
    label: "PhantomBuster",
    description: "Phantom-based scraping for profiles, searches, and follower graphs.",
  },
];

export function parseXDataProvider(value: string | null | undefined): XDataProvider {
  const parsed = XDataProviderSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_X_DATA_PROVIDER;
}

export function getXDataProviderLabel(provider: XDataProvider): string {
  return X_DATA_PROVIDER_OPTIONS.find((option) => option.value === provider)?.label ?? "X API";
}

export { XDataProviderSchema };
export type { XDataProvider };
