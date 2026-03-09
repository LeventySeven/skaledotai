"use client";

import { startTransition, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRightIcon, CheckIcon, FolderOpenIcon, Loader2Icon, SparklesIcon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { trpc } from "@/lib/trpc/client";
import type { ProjectAnalysisResult, ProjectOverview } from "@/lib/types";

function formatFollowers(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function initials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function deriveSummary(project: ProjectOverview): string {
  if (project.leadCount === 0) return "No leads yet.";
  return `${project.leadCount} leads, ${formatFollowers(project.avgFollowers)} avg followers, ${formatFollowers(project.topFollowers)} top follower, ${project.p0LeadCount} P0 leads.`;
}

export function ProjectsWorkspace() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data: overviews = [], isLoading } = trpc.projects.overviews.useQuery();
  const [analysisMode, setAnalysisMode] = useState(false);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [newProjectName, setNewProjectName] = useState("AI shortlist");
  const [uiError, setUiError] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<ProjectAnalysisResult | null>(null);

  const analyzeMutation = trpc.projects.analyze.useMutation({
    onSuccess: async (result) => {
      setAnalysisResult(result);
      setUiError(null);
      await Promise.all([
        utils.projects.list.invalidate(),
        utils.projects.overviews.invalidate(),
        utils.leads.list.invalidate(),
      ]);
      toastManager.add({
        type: "success",
        title: `Created ${result.project.name} from ${result.analyzedProjectIds.length} projects.`,
      });
    },
    onError: (error) => {
      setUiError(error.message);
      toastManager.add({ type: "error", title: error.message });
    },
  });

  const allProjectIds = useMemo(() => overviews.map((project) => project.id), [overviews]);
  const selectedCount = selectedProjectIds.length;

  function enterAnalysisMode() {
    setAnalysisMode(true);
    setSelectedProjectIds(allProjectIds);
    setUiError(null);
  }

  function toggleProject(projectId: string) {
    if (!analysisMode) {
      startTransition(() => {
        router.push(`/leads?project=${projectId}`);
      });
      return;
    }

    setSelectedProjectIds((current) =>
      current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId],
    );
  }

  async function handleCreateAiProject() {
    if (selectedProjectIds.length === 0) {
      setUiError("Select at least one project for AI analysis.");
      return;
    }

    setUiError(null);
    await analyzeMutation.mutateAsync({
      projectIds: selectedProjectIds,
      name: newProjectName.trim() || "AI shortlist",
    });
  }

  return (
    <div className="mx-auto max-w-[1660px] px-8 py-8">
      <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="text-[2.9rem] font-semibold tracking-[-0.04em]">Projects</h1>
          <p className="mt-2 max-w-[720px] text-[1rem] text-muted-foreground">
            Open any project to view its spreadsheet, or run AI analysis across multiple projects to generate a new shortlist sheet.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {!analysisMode ? (
            <Button className="h-10 rounded-xl px-4 text-[0.95rem]" onClick={enterAnalysisMode}>
              <SparklesIcon className="size-4" />
              AI analysis
            </Button>
          ) : (
            <>
              <Input
                className="h-10 w-[230px] rounded-xl text-[0.95rem]"
                value={newProjectName}
                onChange={(event) => setNewProjectName(event.target.value)}
                placeholder="New project name"
              />
              <Button
                className="h-10 rounded-xl px-4 text-[0.95rem]"
                disabled={analyzeMutation.isPending}
                onClick={() => {
                  handleCreateAiProject().catch(() => undefined);
                }}
              >
                {analyzeMutation.isPending ? <Loader2Icon className="size-4 animate-spin" /> : <SparklesIcon className="size-4" />}
                Create AI Project
              </Button>
              <Button
                variant="outline"
                className="h-10 rounded-xl px-4 text-[0.95rem]"
                onClick={() => {
                  setAnalysisMode(false);
                  setSelectedProjectIds([]);
                  setUiError(null);
                }}
              >
                Cancel
              </Button>
            </>
          )}
        </div>
      </div>

      {analysisMode ? (
        <div className="mb-5 flex items-center gap-3 rounded-2xl border border-border bg-muted/30 px-4 py-3 text-[0.95rem]">
          <Badge variant="outline" className="h-7 rounded-full px-3 text-[0.82rem] font-semibold">
            {selectedCount} selected
          </Badge>
          <span className="text-muted-foreground">
            All projects start selected. Click any card to remove or re-add it before analysis.
          </span>
        </div>
      ) : null}

      {uiError ? (
        <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[0.95rem] text-red-700">
          {uiError}
        </div>
      ) : null}

      {analysisResult ? (
        <div className="mb-6 rounded-[1.2rem] border border-border bg-card px-5 py-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-[840px]">
              <div className="mb-2 text-[0.9rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Latest AI analysis
              </div>
              <p className="text-[1rem] text-foreground">{analysisResult.summary}</p>
            </div>
            <Button
              render={<Link href={`/leads?project=${analysisResult.project.id}`} />}
              className="h-10 rounded-xl px-4 text-[0.95rem]"
            >
              Open created sheet
              <ArrowRightIcon className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex h-[260px] items-center justify-center text-muted-foreground">
          <Spinner className="size-4" />
          <span className="ml-2">Loading projects...</span>
        </div>
      ) : overviews.length === 0 ? (
        <div className="rounded-[1.2rem] border border-border bg-card px-6 py-10 text-center text-muted-foreground">
          No projects yet. Run a search first to create one.
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
          {overviews.map((project) => {
            const selected = selectedProjectIds.includes(project.id);

            return (
              <div
                key={project.id}
                onClick={() => toggleProject(project.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    toggleProject(project.id);
                  }
                }}
                role="button"
                tabIndex={0}
                className={`overflow-hidden rounded-[1.2rem] border bg-card text-left transition-colors ${
                  analysisMode
                    ? selected
                      ? "border-foreground/20 ring-1 ring-foreground/10"
                    : "border-border opacity-70"
                    : "border-border hover:border-foreground/20"
                }`}
              >
                <div className="flex items-start justify-between gap-4 border-b border-border/60 px-5 py-4">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <div className="text-[1.15rem] font-semibold">{project.name}</div>
                      {analysisMode && selected ? (
                        <Badge className="h-6 rounded-full px-2 text-[0.72rem] font-semibold">
                          <CheckIcon className="size-3.5" />
                          Included
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-1 text-[0.92rem] text-muted-foreground">
                      {deriveSummary(project)}
                    </div>
                  </div>

                  {!analysisMode ? (
                    <Button
                      variant="outline"
                      className="h-9 rounded-xl px-3 text-[0.88rem]"
                      onClick={(event) => {
                        event.stopPropagation();
                        startTransition(() => {
                          router.push(`/leads?project=${project.id}`);
                        });
                      }}
                    >
                      <FolderOpenIcon className="size-4" />
                      Open
                    </Button>
                  ) : null}
                </div>

                <div className="px-5 py-4">
                  <div className="mb-3 text-[0.85rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    Preview
                  </div>
                  <div className="overflow-hidden rounded-lg border border-border/70">
                    <div className="grid grid-cols-[minmax(0,1fr)_88px_64px] border-b border-border/60 bg-muted/10 px-3 py-2 text-[0.8rem] font-medium text-muted-foreground">
                      <div>Name</div>
                      <div className="text-center">Followers</div>
                      <div className="text-center">P</div>
                    </div>
                    {project.previewLeads.length === 0 ? (
                      <div className="px-3 py-5 text-[0.9rem] text-muted-foreground">
                        No leads yet.
                      </div>
                    ) : (
                      project.previewLeads.map((lead) => (
                        <div
                          key={lead.id}
                          className="grid grid-cols-[minmax(0,1fr)_88px_64px] items-center border-b border-border/45 px-3 py-2.5 last:border-b-0"
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            <Avatar className="size-8">
                              {lead.avatarUrl ? <AvatarImage src={lead.avatarUrl} alt={lead.name} /> : null}
                              <AvatarFallback>{initials(lead.name)}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <div className="truncate text-[0.92rem] font-medium">{lead.name}</div>
                              <div className="truncate text-[0.82rem] text-muted-foreground">@{lead.handle}</div>
                            </div>
                          </div>
                          <div className="text-center text-[0.88rem] font-semibold">
                            {formatFollowers(lead.followers)}
                          </div>
                          <div className="text-center">
                            <Badge
                              variant="outline"
                              className="h-6 rounded-sm border-transparent px-1.5 text-[0.72rem] font-semibold"
                            >
                              {lead.priority}
                            </Badge>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
