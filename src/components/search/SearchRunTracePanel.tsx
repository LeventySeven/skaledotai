"use client";

import { ActivityIcon, Clock3Icon, NetworkIcon, SparklesIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ProjectRunTrace, ProjectRunTraceStep } from "@/lib/validations/project-runs";
import type { SearchRunStreamSnapshot } from "@/lib/validations/search";
import { cn } from "@/lib/utils";

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${durationMs}ms`;
  return `${(durationMs / 1_000).toFixed(1)}s`;
}

export function SearchRunTracePanel({
  steps,
  snapshot,
  isPending,
  trace,
}: {
  steps: ProjectRunTraceStep[];
  snapshot?: SearchRunStreamSnapshot | null;
  isPending: boolean;
  trace?: ProjectRunTrace | null;
}) {
  const latestStepId = isPending ? steps.at(-1)?.id : undefined;

  return (
    <div className="mt-4 rounded-[26px] border border-border/70 bg-card shadow-xs/5">
      <div className="border-b border-border/60 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={isPending ? "secondary" : "outline"}>
            {isPending ? "Live Stream" : "Completed"}
          </Badge>
          <Badge variant="outline">LangGraph</Badge>
          {trace ? <Badge variant="outline">{formatDuration(trace.durationMs)}</Badge> : null}
        </div>
        <h3 className="mt-3 text-[1.15rem] font-semibold tracking-[-0.02em]">Search reasoning</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Real node updates from the multi-agent discovery graph plus the downstream search phases.
        </p>
      </div>

      {snapshot ? (
        <div className="grid gap-3 border-b border-border/60 px-5 py-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Queries", value: snapshot.queries, icon: SparklesIcon },
            { label: "URLs", value: snapshot.urls, icon: NetworkIcon },
            { label: "Payloads", value: snapshot.scraped, icon: ActivityIcon },
            { label: "Candidates", value: snapshot.candidates, icon: Clock3Icon },
          ].map((metric) => (
            <div key={metric.label} className="rounded-[20px] border border-border/70 bg-background/70 px-4 py-3">
              <div className="flex items-center justify-between gap-3 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <span>{metric.label}</span>
                <metric.icon className="size-3.5" />
              </div>
              <div className="mt-2 text-[1.2rem] font-semibold tracking-[-0.03em]">{metric.value}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="space-y-3 p-4">
        {steps.length === 0 ? (
          <div className="rounded-[22px] border border-dashed border-border/80 bg-muted/15 px-4 py-5 text-sm text-muted-foreground">
            {isPending
              ? "Waiting for the first LangGraph update."
              : "No streamed reasoning was recorded for this run."}
          </div>
        ) : (
          steps.map((step, index) => {
            const isActive = latestStepId === step.id;
            return (
              <div
                key={step.id}
                className={cn(
                  "rounded-[22px] border px-4 py-4 transition-colors",
                  isActive
                    ? "border-emerald-300 bg-emerald-50/70"
                    : "border-border/70 bg-background/70",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <div
                        className={cn(
                          "size-2.5 rounded-full",
                          isActive ? "bg-emerald-500" : "bg-foreground/70",
                        )}
                      />
                      <div className="text-sm font-semibold">{step.title}</div>
                      <span className="text-xs text-muted-foreground">Step {index + 1}</span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.summary}</p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {step.provider ? <Badge variant="outline">{step.provider}</Badge> : null}
                    {step.model ? <Badge variant="secondary">{step.model}</Badge> : null}
                    <Badge variant={isActive ? "secondary" : "outline"}>
                      {isActive ? "Streaming" : step.status}
                    </Badge>
                  </div>
                </div>

                {step.metrics.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {step.metrics.map((metric) => (
                      <Badge key={`${step.id}-${metric.label}`} variant="outline" className="rounded-full bg-card">
                        {metric.label}: {metric.value}
                      </Badge>
                    ))}
                  </div>
                ) : null}

                {step.bullets.length > 0 ? (
                  <div className="mt-4 space-y-2">
                    {step.bullets.map((bullet) => (
                      <div key={`${step.id}-${bullet}`} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <SparklesIcon className="mt-0.5 size-3.5 shrink-0" />
                        <span>{bullet}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {trace ? (
        <div className="border-t border-border/60 px-5 py-4 text-sm text-muted-foreground">
          {trace.summary}
        </div>
      ) : null}
    </div>
  );
}
