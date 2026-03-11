import "server-only";
import type { InfluencerScore, XDataProvider, XLeadCandidate } from "@/lib/x";
import { X_DATA_PROVIDER_OPTIONS } from "@/lib/x";
import { getXDiscoveryProvider, getXProviderRuntimeStatuses } from "@/lib/x/registry";
import { scoreLeadCandidate } from "@/lib/openai";

export type ProviderComparisonResult = {
  provider: XDataProvider;
  candidates: XLeadCandidate[];
  scores: InfluencerScore[];
  qualifiedCount: number;
  averageScore: number;
};

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export async function compareXDiscoveryProviders(input: {
  niche: string;
  seedHandle?: string;
  limit?: number;
  providers?: XDataProvider[];
}): Promise<ProviderComparisonResult[]> {
  const configuredProviders = new Set(
    getXProviderRuntimeStatuses()
      .filter((status) => status.configured)
      .map((status) => status.provider),
  );
  const providers = input.providers ?? X_DATA_PROVIDER_OPTIONS.map((option) => option.value);

  const results: ProviderComparisonResult[] = [];

  for (const provider of providers) {
    if (!configuredProviders.has(provider)) continue;

    const { provider: discoveryProvider } = getXDiscoveryProvider(provider);
    const candidates = await discoveryProvider.discoverCandidates({
      niche: input.niche,
      seedHandle: input.seedHandle,
      limit: input.limit ?? 25,
    });
    const scores = await Promise.all(candidates.slice(0, input.limit ?? 25).map(scoreLeadCandidate));

    results.push({
      provider,
      candidates,
      scores,
      qualifiedCount: scores.filter((score) => score.is_influencer && score.fit_for_niche).length,
      averageScore: average(scores.map((score) => score.overall_score)),
    });
  }

  return results.sort((a, b) => b.qualifiedCount - a.qualifiedCount || b.averageScore - a.averageScore);
}
