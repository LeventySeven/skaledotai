"use client";

import { XDataProviderSelector } from "@/components/providers/XDataProviderSelector";
import { XDataSourceSummaryCard } from "@/components/providers/XDataSourceSummaryCard";
import { Badge } from "@/components/ui/badge";

export function XDataSourceWorkspace() {
  return (
    <div className="mx-auto max-w-[1180px] px-8 py-10">
      <div className="max-w-[780px]">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Global preference</Badge>
          <Badge variant="secondary">Settings</Badge>
        </div>
        <h1 className="mt-4 text-[3rem] font-semibold tracking-[-0.04em]">X data source</h1>
        <p className="mt-3 text-[1.03rem] leading-7 text-muted-foreground">
          Choose the global X provider once and let Skale use it consistently for search, follower imports, stats,
          and AI analysis. Search thresholds and project settings stay on the search forms, which keeps this page
          aligned with the current architecture.
        </p>
      </div>

      <div className="mt-10 grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_360px]">
        <section className="rounded-[30px] border border-border bg-card p-6 shadow-xs/5">
          <div className="max-w-[720px]">
            <h2 className="text-[1.7rem] font-semibold tracking-[-0.03em]">Provider selection</h2>
            <p className="mt-2 text-[0.98rem] leading-7 text-muted-foreground">
              Each option plugs into the same adapter contract. Search always uses the selected provider for discovery,
              and unsupported lookup, network, or tweet-history surfaces fall back through the configured full provider.
            </p>
          </div>

          <XDataProviderSelector className="mt-6" />
        </section>

        <div className="space-y-6">
          <section className="rounded-[30px] border border-border bg-card p-6 shadow-xs/5">
            <h2 className="text-[1.35rem] font-semibold tracking-[-0.03em]">Current source</h2>
            <XDataSourceSummaryCard className="mt-4" showButton={false} />
          </section>

        </div>
      </div>
    </div>
  );
}
