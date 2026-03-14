"use client";

import { startTransition, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRightIcon, Loader2Icon, SparklesIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ReasoningSheet, type LiveReasoningStep } from "@/components/runs/ReasoningSheet";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { trpc } from "@/lib/trpc/client";
import type { ProjectAnalysisResult } from "@/lib/validations/projects";
import { ProjectCard } from "./ProjectCard";

const ANALYSIS_REASONING_STEPS: LiveReasoningStep[] = [
  {
    id: "pool",
    title: "Candidate pool",
    summary: "Merging selected campaigns, deduplicating leads, and ranking the strongest candidates.",
  },
  {
    id: "enrichment",
    title: "Signal enrichment",
    summary: "Refreshing tweet activity and engagement signals for the shortlist.",
  },
  {
    id: "shortlist",
    title: "AI shortlist",
    summary: "The model compares commercial signals, audience quality, and activity before picking the final list.",
  },
  {
    id: "insert",
    title: "Spreadsheet insert",
    summary: "Creating the new shortlist sheet and attaching the chosen leads.",
  },
] as const;

export function ProjectsWorkspace() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data: overviews = [], isLoading } = trpc.projects.overviews.useQuery();
  const [analysisMode, setAnalysisMode] = useState(false);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [newProjectName, setNewProjectName] = useState("AI shortlist");
  const [uiError, setUiError] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<ProjectAnalysisResult | null>(null);
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const deleteMutation = trpc.projects.delete.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.projects.list.invalidate(),
        utils.projects.overviews.invalidate(),
        utils.leads.list.invalidate(),
      ]);
      toastManager.add({ type: "success", title: "Campaign deleted." });
    },
    onError: (error) => {
      toastManager.add({ type: "error", title: error.message });
    },
  });

  const analyzeMutation = trpc.projects.analyze.useMutation({
    onSuccess: async (result) => {
      setAnalysisResult(result);
      setReasoningOpen(true);
      setUiError(null);
      await Promise.all([
        utils.projects.list.invalidate(),
        utils.projects.overviews.invalidate(),
        utils.leads.list.invalidate(),
      ]);
      toastManager.add({
        type: "success",
        title: `Created ${result.project.name} from ${result.analyzedProjectIds.length} campaigns.`,
      });
    },
    onError: (error) => {
      setReasoningOpen(false);
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

  function handleDelete(projectId: string) {
    const overview = overviews.find((o) => o.id === projectId);
    setDeleteTarget({ id: projectId, name: overview?.name ?? "" });
    setDeleteConfirmText("");
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    deleteMutation.mutate(
      { projectId: deleteTarget.id },
      { onSettled: () => setDeleteTarget(null) },
    );
  }

  async function handleCreateAiProject() {
    if (selectedProjectIds.length === 0) {
      setUiError("Select at least one campaign for AI analysis.");
      return;
    }

    setUiError(null);
    setAnalysisResult(null);
    setReasoningOpen(true);
    await analyzeMutation.mutateAsync({
      projectIds: selectedProjectIds,
      name: newProjectName.trim() || "AI shortlist",
    });
  }

  return (
    <div className="mx-auto max-w-[1660px] px-8 py-8">
      <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="text-[2.9rem] font-semibold tracking-[-0.04em]">Campaigns</h1>
          <p className="mt-2 max-w-[720px] text-[1rem] text-muted-foreground">
            Open any campaign to view its spreadsheet, or run AI analysis across multiple campaigns to generate a new shortlist sheet.
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
                placeholder="New campaign name"
              />
              <Button
                className="h-10 rounded-xl px-4 text-[0.95rem]"
                disabled={analyzeMutation.isPending}
                onClick={() => {
                  handleCreateAiProject().catch(() => undefined);
                }}
              >
                {analyzeMutation.isPending ? <Loader2Icon className="size-4 animate-spin" /> : <SparklesIcon className="size-4" />}
                Create AI Campaign
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
            All campaigns start selected. Click any card to remove or re-add it before analysis.
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
            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                className="h-10 rounded-xl px-4 text-[0.95rem]"
                onClick={() => setReasoningOpen(true)}
              >
                View reasoning
              </Button>
              <Button
                render={<Link href={`/leads?project=${analysisResult.project.id}`} />}
                className="h-10 rounded-xl px-4 text-[0.95rem]"
              >
                Open created sheet
                <ArrowRightIcon className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex h-[260px] items-center justify-center text-muted-foreground">
          <Spinner className="size-4" />
          <span className="ml-2">Loading campaigns...</span>
        </div>
      ) : overviews.length === 0 ? (
        <div className="rounded-[1.2rem] border border-border bg-card px-6 py-10 text-center text-muted-foreground">
          No campaigns yet. Run a search first to create one.
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
          {overviews.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              analysisMode={analysisMode}
              selected={selectedProjectIds.includes(project.id)}
              onToggle={toggleProject}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      <ReasoningSheet
        open={reasoningOpen}
        onOpenChange={setReasoningOpen}
        title="AI Analysis Reasoning"
        description="Watching shortlist assembly, signal enrichment, model selection, and final spreadsheet insert."
        isPending={analyzeMutation.isPending}
        liveSteps={ANALYSIS_REASONING_STEPS}
        trace={analysisResult?.trace}
      />

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogPopup showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete campaign</DialogTitle>
            <DialogDescription>
              This action cannot be undone. Type <span className="font-semibold text-foreground">{deleteTarget?.name}</span> to confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-2">
            <Input
              className="h-[42px] rounded-[10px] text-[0.95rem]"
              placeholder={deleteTarget?.name}
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" className="h-9 rounded-xl px-4 text-[0.88rem]" />}>
              Cancel
            </DialogClose>
            <Button
              variant="destructive"
              className="h-9 rounded-xl px-4 text-[0.88rem]"
              disabled={deleteConfirmText !== deleteTarget?.name || deleteMutation.isPending}
              onClick={confirmDelete}
            >
              {deleteMutation.isPending ? <Spinner className="size-3.5" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
