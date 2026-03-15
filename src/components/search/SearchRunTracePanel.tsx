"use client";

import { useEffect, useRef, useState } from "react";
import {
  ActivityIcon,
  ChevronDownIcon,
  Clock3Icon,
  GitBranchPlusIcon,
  NetworkIcon,
  SparklesIcon,
  TargetIcon,
  WrenchIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ProjectRunTrace, ProjectRunTraceStep } from "@/lib/validations/project-runs";
import type { SearchRunGraphNode, SearchRunStreamSnapshot } from "@/lib/validations/search";
import { cn } from "@/lib/utils";

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${durationMs}ms`;
  return `${(durationMs / 1_000).toFixed(1)}s`;
}

function resolveGraphNodes(
  snapshot: SearchRunStreamSnapshot | null | undefined,
  steps: ProjectRunTraceStep[],
  isPending: boolean,
): SearchRunGraphNode[] {
  if (snapshot?.graphNodes.length) {
    return isPending
      ? snapshot.graphNodes
      : snapshot.graphNodes.map((node) => ({ ...node, status: "complete" }));
  }

  return steps.map((step, index) => ({
    id: step.id,
    title: step.title,
    status:
      !isPending ? "complete"
      : index === steps.length - 1 ? "active"
      : "complete",
  }));
}

function getNodeTone(status: SearchRunGraphNode["status"]) {
  if (status === "active") {
    return {
      card: "border-emerald-500/35 bg-emerald-50/90 text-emerald-900 shadow-[0_18px_50px_-32px_rgba(16,185,129,0.45)]",
      dot: "bg-emerald-500 ring-4 ring-emerald-300/90",
      edge: "bg-gradient-to-r from-emerald-400 via-emerald-200 to-border/35",
      label: "Streaming",
    };
  }

  if (status === "complete") {
    return {
      card: "border-border/80 bg-background/85 text-foreground",
      dot: "bg-foreground/80",
      edge: "bg-gradient-to-r from-foreground/30 via-border/70 to-border/35",
      label: "Done",
    };
  }

  return {
    card: "border-border/65 bg-muted/20 text-muted-foreground",
    dot: "bg-muted-foreground/35",
    edge: "bg-gradient-to-r from-border/55 via-border/35 to-border/15",
    label: "Queued",
  };
}

function GraphLane({
  nodes,
  snapshot,
}: {
  nodes: SearchRunGraphNode[];
  snapshot?: SearchRunStreamSnapshot | null;
}) {
  return (
    <div className="overflow-hidden rounded-[26px] border border-border/70 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.12),_transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.88),rgba(248,250,252,0.96))] p-4 dark:bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.18),_transparent_28%),linear-gradient(180deg,rgba(15,23,42,0.8),rgba(15,23,42,0.96))]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Execution Graph
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Nodes do the work, edges show the handoff, and the highlighted card marks the live super-step.
          </p>
        </div>
        {snapshot ? (
          <div className="rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs text-muted-foreground">
            Pass {snapshot.attempt} / {snapshot.maxAttempts}
          </div>
        ) : null}
      </div>

      <div className="overflow-x-auto pb-1">
        <div className="flex min-w-max items-center gap-2">
          <GraphTerminal label="START" />
          {nodes.map((node, index) => {
            const tone = getNodeTone(node.status);
            return (
              <div key={node.id} className="flex items-center gap-2">
                <div
                  className={cn(
                    "relative w-[192px] rounded-[22px] border px-4 py-3 transition-all duration-300",
                    tone.card,
                    node.status === "active" && "trace-active-shimmer",
                  )}
                >
                  <div className="relative flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div className={cn("size-2.5 rounded-full", tone.dot)} />
                      <span className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        S{index + 1}
                      </span>
                    </div>
                    <Badge variant={node.status === "active" ? "secondary" : "outline"} className="rounded-full px-2">
                      {tone.label}
                    </Badge>
                  </div>
                  <div className="mt-3 text-sm font-semibold leading-5">{node.title}</div>
                </div>
                {index < nodes.length - 1 ? (
                  <div
                    className={cn(
                      "h-px w-9 rounded-full",
                      tone.edge,
                      node.status === "active" && "trace-edge-shimmer",
                    )}
                  />
                ) : null}
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
    <div className="flex h-[108px] w-[92px] shrink-0 items-center justify-center rounded-[22px] border border-dashed border-border/80 bg-background/80 text-xs font-semibold tracking-[0.18em] text-muted-foreground">
      {label}
    </div>
  );
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
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const reasoningEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest step when new steps arrive
  useEffect(() => {
    if (reasoningOpen && isPending && reasoningEndRef.current) {
      reasoningEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [steps.length, reasoningOpen, isPending]);
  const latestStepId = isPending ? steps.at(-1)?.id : undefined;
  const graphNodes = resolveGraphNodes(snapshot, steps, isPending);

  return (
    <div className="mt-4 rounded-[26px] border border-emerald-200/70 bg-card shadow-xs/5">
      <div className="border-b border-emerald-200/60 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={isPending ? "secondary" : "outline"} className={isPending ? "bg-emerald-100 text-emerald-800" : ""}>
            {isPending ? "Live Stream" : "Completed"}
          </Badge>
          <Badge variant="outline">LangGraph</Badge>
          {trace ? <Badge variant="outline">{formatDuration(trace.durationMs)}</Badge> : null}
          {snapshot?.activeNode ? <Badge variant="outline">Node: {snapshot.activeNode}</Badge> : null}
          {snapshot?.activeSubagent ? <Badge variant="outline">Subagent: {snapshot.activeSubagent}</Badge> : null}
          {snapshot?.recoveryState ? <Badge variant="outline">Recovery: {snapshot.recoveryState.replace(/_/g, " ")}</Badge> : null}
          {snapshot?.stopReason ? <Badge variant="outline">Stop: {snapshot.stopReason.replace(/_/g, " ")}</Badge> : null}
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-[18px] border border-border/70 bg-background/75 px-4 py-3">
            <div className="flex items-center justify-between gap-3 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <span>Lead Goal</span>
              <TargetIcon className="size-3.5" />
            </div>
            <div className="mt-2 text-[1.2rem] font-semibold tracking-[-0.04em]">
              {snapshot ? `~${snapshot.targetLeadCount}` : "—"}
            </div>
          </div>

          <div className="rounded-[18px] border border-border/70 bg-background/75 px-4 py-3">
            <div className="flex items-center justify-between gap-3 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <span>Pass</span>
              <GitBranchPlusIcon className="size-3.5" />
            </div>
            <div className="mt-2 text-[1.2rem] font-semibold tracking-[-0.04em]">
              {snapshot ? `${snapshot.attempt} / ${snapshot.maxAttempts}` : "1 / 1"}
            </div>
          </div>

          <div className="rounded-[18px] border border-border/70 bg-background/75 px-4 py-3">
            <div className="flex items-center justify-between gap-3 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <span>Candidates</span>
              <NetworkIcon className="size-3.5" />
            </div>
            <div className="mt-2 text-[1.2rem] font-semibold tracking-[-0.04em]">
              {snapshot ? snapshot.candidates : 0}
            </div>
          </div>

          <div className="rounded-[18px] border border-border/70 bg-background/75 px-4 py-3">
            <div className="flex items-center justify-between gap-3 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <span>Runtime</span>
              <Clock3Icon className="size-3.5" />
            </div>
            <div className="mt-2 text-[1.2rem] font-semibold tracking-[-0.04em]">
              {trace ? formatDuration(trace.durationMs) : "Live"}
            </div>
          </div>
        </div>
      </div>

      <div className="p-4">
        {graphNodes.length > 0 ? <GraphLane nodes={graphNodes} snapshot={snapshot} /> : null}

        {/* Collapsible reasoning panel */}
        <div className="mt-4 rounded-[22px] border border-border/70 bg-background/65">
          <button
            type="button"
            onClick={() => setReasoningOpen(!reasoningOpen)}
            className="flex w-full items-center justify-between px-5 py-4 text-left"
          >
            <div className="flex items-center gap-2">
              <ActivityIcon className="size-4 text-muted-foreground" />
              <div className="text-[0.82rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Reasoning ({steps.length} steps)
              </div>
            </div>
            <ChevronDownIcon
              className={cn(
                "size-5 text-muted-foreground transition-transform duration-200",
                reasoningOpen && "rotate-180",
              )}
            />
          </button>

          {reasoningOpen ? (
            <div className="max-h-[600px] space-y-3 overflow-y-auto border-t border-border/60 p-4">
              {steps.length === 0 ? (
                <div className="rounded-[18px] border border-dashed border-border/80 bg-muted/15 px-4 py-5 text-sm text-muted-foreground">
                  {isPending
                    ? "Waiting for the first LangGraph update."
                    : "No streamed reasoning was recorded for this run."}
                </div>
              ) : (
                steps.map((step, index) => {
                  const isActive = latestStepId === step.id;
                  const isLast = index === steps.length - 1;
                  return (
                    <div
                      key={step.id}
                      ref={isLast ? reasoningEndRef : undefined}
                      className={cn(
                        "rounded-[18px] border px-4 py-4 transition-all duration-300",
                        isActive
                          ? "trace-active-shimmer border-emerald-400/35 bg-emerald-50/90"
                          : "border-border/70 bg-background/80",
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
                          {step.subagent ? <Badge variant="outline">{step.subagent}</Badge> : null}
                          {step.model ? <Badge variant="secondary">{step.model}</Badge> : null}
                          <Badge variant={isActive ? "secondary" : "outline"} className={isActive ? "bg-emerald-100 text-emerald-800" : ""}>
                            {isActive ? "Streaming" : step.status}
                          </Badge>
                        </div>
                      </div>

                      {step.metrics.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {step.metrics.map((metric, i) => (
                            <Badge key={`${step.id}-metric-${i}`} variant="outline" className="rounded-full bg-card">
                              {metric.label}: {metric.value}
                            </Badge>
                          ))}
                        </div>
                      ) : null}

                      {step.tools.length > 0 ? (
                        <div className="mt-3">
                          <div className="mb-2 flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            <WrenchIcon className="size-3.5" />
                            <span>Tools used</span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {step.tools.map((tool, i) => (
                              <Badge key={`${step.id}-tool-${i}`} variant="secondary" className="rounded-full">
                                {tool}
                              </Badge>
                            ))}
                          </div>
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
                })
              )}
            </div>
          ) : null}
        </div>
      </div>

      {trace ? (
        <div className="border-t border-emerald-200/60 px-5 py-4 text-sm text-muted-foreground">
          {trace.summary}
        </div>
      ) : null}
    </div>
  );
}
