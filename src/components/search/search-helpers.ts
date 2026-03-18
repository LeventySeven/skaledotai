export {
  mergeTraceSteps,
  readErrorMessage,
  normalizeLiveStreamError,
  getLiveMultiAgentStreamTarget,
} from "@/lib/multiagent-service-client";

export const FOLLOWER_FLOOR_OPTIONS = [
  { label: "Any size", value: 0 },
  { label: "1k+", value: 1_000 },
  { label: "2k+", value: 2_000 },
  { label: "3k+", value: 3_000 },
  { label: "4k+", value: 4_000 },
  { label: "5k+", value: 5_000 },
  { label: "6k+", value: 6_000 },
  { label: "7k+", value: 7_000 },
  { label: "8k+", value: 8_000 },
  { label: "9k+", value: 9_000 },
  { label: "10k+", value: 10_000 },
  { label: "15k+", value: 15_000 },
  { label: "20k+", value: 20_000 },
  { label: "30k+", value: 30_000 },
  { label: "50k+", value: 50_000 },
  { label: "100k+", value: 100_000 },
] as const;

export const LEAD_TARGET_BOUNDS = {
  min: 1,
  max: 300,
} as const;

export const LEAD_TARGET_OPTIONS = [
  { label: "10", value: 10 },
  { label: "25", value: 25 },
  { label: "50", value: 50 },
  { label: "100", value: 100 },
  { label: "150", value: 150 },
  { label: "200", value: 200 },
  { label: "250", value: 250 },
  { label: "300", value: 300 },
] as const;
