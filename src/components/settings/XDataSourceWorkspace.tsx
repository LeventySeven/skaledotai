"use client";

import Link from "next/link";
import {
  ArrowUpRightIcon,
  BarChart3Icon,
  BotIcon,
  SearchIcon,
  UsersIcon,
  WorkflowIcon,
} from "lucide-react";
import { XDataProviderSelector } from "@/components/providers/XDataProviderSelector";
import { XDataSourceSummaryCard } from "@/components/providers/XDataSourceSummaryCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { X_DATA_PROVIDER_OPTIONS } from "@/lib/x";

const ARCHITECTURE_STEPS = [
  {
    title: "Browser preference",
    description: "The selected provider is stored in localStorage so the workspace keeps one global X source.",
  },
  {
    title: "tRPC transport",
    description: "Client requests send the value as the `x-data-provider` header on every authenticated call.",
  },
  {
    title: "Service layer",
    description: "Search, network imports, stats, and AI workflows read the same provider from the shared request context.",
  },
  {
    title: "Provider adapter",
    description: "The server resolves the header through `getXDataClient()` and executes the matching X API, Apify, or PhantomBuster adapter.",
  },
] as const;

const WORKFLOWS = [
  {
    title: "Lead search",
    description: "How Skale finds candidate accounts and related posts for a query.",
    icon: SearchIcon,
    coverage: {
      "x-api": "Native user search plus recent post search, with full-archive search available when that mode is enabled.",
      apify: "Advanced Search Actors return dataset items that Skale normalizes into profiles and tweets.",
      phantombuster: "Twitter Search Export agents provide search results that are normalized into the shared adapter shape.",
    },
  },
  {
    title: "Profile lookup",
    description: "How handles are resolved before imports, stats, and analysis.",
    icon: UsersIcon,
    coverage: {
      "x-api": "Direct user lookup resolves canonical IDs and profile metadata through X API v2.",
      apify: "Twitter User Scraper Actors hydrate handles into profiles, bios, and public metrics.",
      phantombuster: "Twitter Profile Scraper agents resolve profile URLs into structured account data.",
    },
  },
  {
    title: "Network import",
    description: "How follower and following graphs are pulled into projects.",
    icon: WorkflowIcon,
    coverage: {
      "x-api": "Followers and following are fetched through paginated native follow endpoints.",
      apify: "User Scraper Actor runs return follower and following snapshots inside one normalized result set.",
      phantombuster: "Dedicated follower and following collector agents are launched for each import request.",
    },
  },
  {
    title: "Stats and AI context",
    description: "How Skale fetches tweet history for engagement summaries and ranking prompts.",
    icon: BarChart3Icon,
    coverage: {
      "x-api": "Recent tweets come from native user tweet endpoints with public metrics attached.",
      apify: "Tweet history is collected through the User Scraper Actor and mapped into the shared tweet shape.",
      phantombuster: "Profile Scraper agents return tweet history that is reused for stats and AI analysis.",
    },
  },
] as const;

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
              Each option plugs into the same adapter contract, but the execution model is different: direct REST
              calls for X API, synchronous Actor runs for Apify, and agent launches with container polling for
              PhantomBuster.
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

      <section className="mt-6 rounded-[30px] border border-border bg-card p-6 shadow-xs/5">
        <div className="max-w-[840px]">
          <Badge variant="outline">Architecture flow</Badge>
          <h2 className="mt-4 text-[1.7rem] font-semibold tracking-[-0.03em]">How the selection moves through Skale</h2>
          <p className="mt-2 text-[0.98rem] leading-7 text-muted-foreground">
            This page owns provider choice only. The rest of the search form stays task-specific, while the provider
            itself flows through one shared path from the browser to the provider adapter layer.
          </p>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {ARCHITECTURE_STEPS.map((step, index) => (
            <div key={step.title} className="rounded-[22px] border border-border bg-background/70 p-4">
              <div className="flex items-center gap-3">
                <div className="inline-flex size-8 items-center justify-center rounded-xl bg-accent text-sm font-semibold">
                  {index + 1}
                </div>
                <div className="text-[1rem] font-semibold">{step.title}</div>
              </div>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{step.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6 rounded-[30px] border border-border bg-card p-6 shadow-xs/5">
        <div className="max-w-[860px]">
          <Badge variant="outline">Workflow coverage</Badge>
          <h2 className="mt-4 text-[1.7rem] font-semibold tracking-[-0.03em]">Provider workflows mapped to the current adapters</h2>
          <p className="mt-2 text-[0.98rem] leading-7 text-muted-foreground">
            Every provider implements the same interface in code. The cards below describe which external surface each
            adapter uses today for lead search, profile resolution, network imports, and tweet-based analysis.
          </p>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {WORKFLOWS.map((workflow) => {
            const Icon = workflow.icon;

            return (
              <article key={workflow.title} className="rounded-[24px] border border-border bg-background/70 p-5">
                <div className="flex items-start gap-3">
                  <div className="inline-flex size-10 items-center justify-center rounded-2xl bg-accent text-foreground">
                    <Icon className="size-4.5" />
                  </div>
                  <div>
                    <h3 className="text-[1.1rem] font-semibold tracking-[-0.02em]">{workflow.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{workflow.description}</p>
                  </div>
                </div>

                <div className="mt-5 space-y-3">
                  {X_DATA_PROVIDER_OPTIONS.map((option) => (
                    <div
                      key={`${workflow.title}-${option.value}`}
                      className="grid gap-2 rounded-[18px] border border-border/80 bg-card p-3 md:grid-cols-[100px_minmax(0,1fr)]"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{option.label}</span>
                        <Badge size="sm" variant="outline">
                          {option.badge}
                        </Badge>
                      </div>
                      <p className={cn("text-sm leading-6 text-muted-foreground")}>
                        {workflow.coverage[option.value]}
                      </p>
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
