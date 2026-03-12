"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ActivityIcon,
  ArrowRightIcon,
  Clock3Icon,
  GitBranchPlusIcon,
  NetworkIcon,
  OrbitIcon,
  SparklesIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetTitle,
} from "@/components/ui/sheet";
import type { ProjectRunTrace } from "@/lib/validations/project-runs";
import { cn } from "@/lib/utils";

export type LiveReasoningStep = {
  id: string;
  title: string;
  summary: string;
};

type StepStatus = "idle" | "active" | "complete";

type DisplayStep = {
  id: string;
  title: string;
  summary: string;
  status: StepStatus;
  provider?: string;
  model?: string;
  metrics: Array<{ label: string; value: string | number }>;
  bullets: string[];
};

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${durationMs}ms`;
  return `${(durationMs / 1_000).toFixed(1)}s`;
}

function toPendingSteps(steps: LiveReasoningStep[], activeStepIndex: number): DisplayStep[] {
  return steps.map((step, index) => ({
    id: step.id,
    title: step.title,
    summary: step.summary,
    status:
      index < activeStepIndex ? "complete"
      : index === activeStepIndex ? "active"
      : "idle",
    metrics: [],
    bullets: [],
  }));
}

function toTraceDisplaySteps(trace: ProjectRunTrace): DisplayStep[] {
  return trace.steps.map((step) => ({
    id: step.id,
    title: step.title,
    summary: step.summary,
    status: "complete",
    provider: step.provider,
    model: step.model,
    metrics: step.metrics,
    bullets: step.bullets,
  }));
}


function getStepTone(status: StepStatus) {
  if (status === "active") {
    return {
      node: "border-emerald-300 bg-emerald-50 text-emerald-950 shadow-[0_18px_40px_-26px_rgba(16,185,129,0.9)]",
      dot: "bg-emerald-500 ring-4 ring-emerald-200/80",
      line: "from-emerald-300 via-emerald-200 to-border/40",
      label: "Active",
    };
  }

  if (status === "complete") {
    return {
      node: "border-border/80 bg-card text-foreground",
      dot: "bg-foreground/80",
      line: "from-foreground/30 via-border/70 to-border/40",
      label: "Done",
    };
  }

  return {
    node: "border-border/60 bg-muted/20 text-muted-foreground",
    dot: "bg-muted-foreground/30",
    line: "from-border/50 via-border/40 to-border/20",
    label: "Queued",
  };
}

function GraphLane({ steps }: { steps: DisplayStep[] }) {
  return (
    <div className="overflow-hidden rounded-[26px] border border-border/70 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.10),_transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.82),rgba(248,250,252,0.95))] p-4 dark:bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.16),_transparent_34%),linear-gradient(180deg,rgba(15,23,42,0.72),rgba(15,23,42,0.96))]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Execution Graph
          </div>
          <p className="mt-1 max-w-[420px] text-sm text-muted-foreground">
            LangGraph-style view: nodes do the work, edges carry the handoff, and each super-step advances the shared state.
          </p>
        </div>
        <div className="rounded-full border border-border/70 bg-background/70 px-3 py-1 text-xs text-muted-foreground">
          START <ArrowRightIcon className="mx-1 inline size-3" /> END
        </div>
      </div>

      <div className="overflow-x-auto pb-1">
        <div className="flex min-w-max items-center gap-2">
          <GraphTerminal label="START" />
          {steps.map((step, index) => {
            const tone = getStepTone(step.status);
            return (
              <div key={step.id} className="flex items-center gap-2">
                <div className="relative w-[182px] rounded-[22px] border p-3 transition-all duration-300">
                  <div className={cn("absolute inset-0 rounded-[22px] border", tone.node)} />
                  <div className="relative">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <div className={cn("size-2.5 rounded-full", tone.dot, step.status === "active" && "animate-pulse")} />
                        <span className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          S{index + 1}
                        </span>
                      </div>
                      <Badge variant={step.status === "active" ? "secondary" : "outline"} className="rounded-full px-2">
                        {tone.label}
                      </Badge>
                    </div>
                    <div className="text-sm font-semibold leading-5">{step.title}</div>
                    <p className="mt-1.5 line-clamp-3 text-[0.82rem] leading-5 text-muted-foreground">
                      {step.summary}
                    </p>
                  </div>
                </div>
                <div className={cn("h-px w-8 bg-gradient-to-r", tone.line)} />
              </div>
            );
          })}
          <GraphTerminal label="END" />
        </div>
      </div>
    </div>
  );
}

function GraphTerminal({ label }: { label: string }) {
  return (
    <div className="flex h-[110px] w-[92px] shrink-0 items-center justify-center rounded-[22px] border border-dashed border-border/80 bg-background/80 text-xs font-semibold tracking-[0.18em] text-muted-foreground">
      {label}
    </div>
  );
}

function OverviewCards({
  isPending,
  trace,
  steps,
  activeCount,
}: {
  isPending: boolean;
  trace?: ProjectRunTrace | null;
  steps: DisplayStep[];
  activeCount: number;
}) {
  const warningCount = trace?.steps.filter((step) => step.status === "warning").length ?? 0;

  const cards = [
    {
      title: "Nodes",
      value: steps.length,
      caption: "Execution stages",
      icon: NetworkIcon,
    },
    {
      title: "Super-Step",
      value: isPending ? Math.min(activeCount + 1, Math.max(steps.length, 1)) : steps.length,
      caption: isPending ? "Current tick" : "Completed ticks",
      icon: OrbitIcon,
    },
    {
      title: "State",
      value: isPending ? "Streaming" : "Settled",
      caption: isPending ? `${activeCount} active node${activeCount === 1 ? "" : "s"}` : warningCount > 0 ? `${warningCount} warnings surfaced` : "No pending transitions",
      icon: ActivityIcon,
    },
    {
      title: "Runtime",
      value: trace ? formatDuration(trace.durationMs) : "Live",
      caption: trace ? "Observed wall time" : "Awaiting final state",
      icon: Clock3Icon,
    },
  ];

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <div key={card.title} className="rounded-[22px] border border-border/70 bg-card px-4 py-4 shadow-xs/5">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {card.title}
            </div>
            <card.icon className="size-4 text-muted-foreground" />
          </div>
          <div className="mt-3 text-[1.35rem] font-semibold tracking-[-0.04em]">{card.value}</div>
          <p className="mt-1 text-xs text-muted-foreground">{card.caption}</p>
        </div>
      ))}
    </div>
  );
}

function StreamBoard({
  steps,
  trace,
}: {
  steps: DisplayStep[];
  trace?: ProjectRunTrace | null;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.9fr)]">
      <div className="rounded-[26px] border border-border/70 bg-card">
        <div className="border-b border-border/60 px-5 py-4">
          <div className="flex items-center gap-2">
            <GitBranchPlusIcon className="size-4 text-muted-foreground" />
            <div className="text-[0.82rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              State Updates
            </div>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            `updates` mode view: each node emits a compact delta describing what changed in the graph.
          </p>
        </div>

        <div className="space-y-3 p-4">
          {steps.map((step, index) => {
            const tone = getStepTone(step.status);
            return (
              <div
                key={step.id}
                className={cn(
                  "rounded-[22px] border px-4 py-4 transition-all duration-300",
                  tone.node,
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className={cn("size-2.5 rounded-full", tone.dot, step.status === "active" && "animate-pulse")} />
                      <div className="text-sm font-semibold">{step.title}</div>
                      <span className="text-xs text-muted-foreground">Step {index + 1}</span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.summary}</p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {step.provider ? <Badge variant="outline">{step.provider}</Badge> : null}
                    {step.model ? <Badge variant="secondary">{step.model}</Badge> : null}
                    <Badge variant={step.status === "active" ? "secondary" : "outline"}>
                      {tone.label}
                    </Badge>
                  </div>
                </div>

                {step.metrics.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {step.metrics.map((metric, i) => (
                      <Badge key={`${step.id}-metric-${i}`} variant="outline" className="rounded-full bg-background/70">
                        {metric.label}: {metric.value}
                      </Badge>
                    ))}
                  </div>
                ) : null}

                {step.bullets.length > 0 ? (
                  <div className="mt-4 space-y-2">
                    {step.bullets.map((bullet, i) => (
                      <div key={`${step.id}-bullet-${i}`} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <SparklesIcon className="mt-0.5 size-3.5 shrink-0" />
                        <span>{bullet}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-[26px] border border-border/70 bg-card">
          <div className="border-b border-border/60 px-5 py-4">
            <div className="text-[0.82rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Full State
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              `values` mode view: the graph snapshot after each super-step boundary.
            </p>
          </div>

          <div className="space-y-3 p-4">
            {steps.map((step, index) => (
              <div key={`snapshot-${step.id}`} className="rounded-[20px] border border-border/70 bg-muted/15 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold">{`Snapshot ${index + 1}`}</div>
                  <Badge variant="outline">{step.status === "active" ? "In flight" : "Committed"}</Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {step.title} updated the shared graph state.
                </p>
                {step.metrics.length > 0 ? (
                  <div className="mt-3 grid gap-2">
                    {step.metrics.slice(0, 3).map((metric, i) => (
                      <div key={`snapshot-${step.id}-metric-${i}`} className="flex items-center justify-between rounded-xl bg-background/80 px-3 py-2 text-xs">
                        <span className="text-muted-foreground">{metric.label}</span>
                        <span className="font-semibold">{metric.value}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl bg-background/80 px-3 py-2 text-xs text-muted-foreground">
                    Waiting for node-specific values to land.
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {trace ? (
          <div className="rounded-[26px] border border-border/70 bg-card px-5 py-4">
            <div className="text-[0.82rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Execution Notes
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {trace.summary}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ReasoningSheet({
  open,
  onOpenChange,
  title,
  description,
  isPending,
  liveSteps,
  trace,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  isPending: boolean;
  liveSteps: LiveReasoningStep[];
  trace?: ProjectRunTrace | null;
}) {
  const [activeStepIndex, setActiveStepIndex] = useState(0);

  useEffect(() => {
    if (!open) {
      setActiveStepIndex(0);
      return;
    }

    if (!isPending) {
      setActiveStepIndex(Math.max(liveSteps.length - 1, 0));
      return;
    }

    setActiveStepIndex(0);
    const intervalId = window.setInterval(() => {
      setActiveStepIndex((current) => (current + 1) % Math.max(liveSteps.length, 1));
    }, 1_350);

    return () => window.clearInterval(intervalId);
  }, [isPending, liveSteps.length, open]);

  const pendingSteps = useMemo(
    () => toPendingSteps(liveSteps, activeStepIndex),
    [activeStepIndex, liveSteps],
  );
  const traceSteps = useMemo(
    () => (trace ? toTraceDisplaySteps(trace) : []),
    [trace],
  );
  const displaySteps = trace ? traceSteps : pendingSteps;
  const activeCount = trace
    ? 0
    : pendingSteps.filter((step) => step.status === "active").length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" variant="inset" className="max-w-[760px]">
        <SheetHeader className="border-b border-border/60 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.14),_transparent_34%),radial-gradient(circle_at_top_right,_rgba(15,23,42,0.08),_transparent_28%),linear-gradient(180deg,rgba(248,250,252,0.92),rgba(255,255,255,0.85))] dark:bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.20),_transparent_34%),radial-gradient(circle_at_top_right,_rgba(148,163,184,0.12),_transparent_28%),linear-gradient(180deg,rgba(15,23,42,0.88),rgba(15,23,42,0.80))]">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={isPending ? "secondary" : "outline"}>
              {isPending ? "Live Stream" : "Completed"}
            </Badge>
            <Badge variant="outline">
              LangGraph-Inspired
            </Badge>
            {trace ? (
              <Badge variant="outline">{formatDuration(trace.durationMs)}</Badge>
            ) : null}
          </div>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{trace?.summary ?? description}</SheetDescription>
        </SheetHeader>

        <SheetPanel className="space-y-4 bg-[radial-gradient(circle_at_1px_1px,rgba(15,23,42,0.055)_1px,transparent_0)] [background-size:18px_18px] dark:bg-[radial-gradient(circle_at_1px_1px,rgba(148,163,184,0.10)_1px,transparent_0)]">
          <OverviewCards
            isPending={isPending}
            trace={trace}
            steps={displaySteps}
            activeCount={activeCount}
          />
          <GraphLane steps={displaySteps} />
          <StreamBoard steps={displaySteps} trace={trace} />
        </SheetPanel>
      </SheetContent>
    </Sheet>
  );
}
