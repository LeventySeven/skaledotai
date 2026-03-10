"use client";

import Link from "next/link";
import {
  ArrowUpRightIcon,
  BotIcon,
} from "lucide-react";
import { XDataProviderSelector } from "@/components/providers/XDataProviderSelector";
import { XDataSourceSummaryCard } from "@/components/providers/XDataSourceSummaryCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X_DATA_PROVIDER_OPTIONS } from "@/lib/x";

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

          <section className="rounded-[30px] border border-border bg-card p-6 shadow-xs/5">
            <div className="flex items-center gap-3">
              <div className="inline-flex size-10 items-center justify-center rounded-2xl bg-accent text-foreground">
                <BotIcon className="size-4.5" />
              </div>
              <div>
                <h2 className="text-[1.35rem] font-semibold tracking-[-0.03em]">Official docs</h2>
                <p className="text-sm text-muted-foreground">Source links for the exact surfaces this page describes.</p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {X_DATA_PROVIDER_OPTIONS.map((option) => (
                <div key={option.value} className="rounded-[22px] border border-border bg-background/70 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-[1rem] font-semibold">{option.label}</div>
                    <Badge size="sm" variant="outline">
                      {option.badge}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{option.integration}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {option.docs.map((doc) => (
                      <Button
                        key={doc.href}
                        render={<Link href={doc.href} target="_blank" rel="noreferrer" />}
                        variant="outline"
                        size="sm"
                        className="rounded-xl"
                      >
                        {doc.label}
                        <ArrowUpRightIcon className="size-4" />
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
