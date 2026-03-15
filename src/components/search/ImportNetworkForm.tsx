"use client";

import { type FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ReasoningSheet, type LiveReasoningStep } from "@/components/runs/ReasoningSheet";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { trpc } from "@/lib/trpc/client";
import type { ProjectRunTrace } from "@/lib/validations/project-runs";

const NETWORK_REASONING_STEPS: LiveReasoningStep[] = [
  {
    id: "lookup",
    title: "Seed lookup",
    summary: "Resolving the source account before walking its network graph.",
  },
  {
    id: "network",
    title: "Network sweep",
    summary: "Reading followers and following pages and deduplicating the accounts.",
  },
  {
    id: "insert",
    title: "Spreadsheet insert",
    summary: "Writing the imported network rows into the selected campaign sheet.",
  },
] as const;

export function ImportNetworkForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rerunUsername = searchParams.get("importUsername");
  const rerunProjectId = rerunUsername ? searchParams.get("project") : null;
  const utils = trpc.useUtils();
  const [networkUsername, setNetworkUsername] = useState(rerunUsername ?? "");
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [reasoningTrace, setReasoningTrace] = useState<ProjectRunTrace | null>(null);

  const importMutation = trpc.search.importNetwork.useMutation({
    onSuccess: async (result) => {
      setReasoningTrace(result.trace);
      await Promise.all([
        utils.projects.list.invalidate(),
        utils.leads.list.invalidate(),
      ]);
      toastManager.add({
        type: "success",
        title: `Imported ${result.leads.length} leads into ${result.project.name}.`,
      });
      window.setTimeout(() => {
        router.push(`/leads?project=${result.project.id}`);
      }, 350);
    },
    onError: (error) => {
      setReasoningTrace(null);
      setReasoningOpen(false);
      toastManager.add({ type: "error", title: error.message });
    },
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Strip @, whitespace, and x.com/twitter.com URL prefixes
    const cleanHandle = networkUsername
      .trim()
      .replace(/^https?:\/\/(www\.)?(x\.com|twitter\.com)\//i, "")
      .replace(/^@/, "")
      .replace(/\/.*$/, "")
      .trim();
    if (!cleanHandle) return;

    setReasoningTrace(null);
    setReasoningOpen(true);
    await importMutation.mutateAsync({
      username: cleanHandle,
      projectId: rerunProjectId ?? undefined,
      projectName: rerunProjectId ? undefined : `${cleanHandle} leads`,
    });
  }

  return (
    <>
      {rerunProjectId ? (
        <div className="mb-2 flex items-center justify-between rounded-[10px] border border-border px-3.5 py-2.5">
          <span className="text-[0.88rem] text-muted-foreground">Re-importing into existing campaign</span>
          <Button
            type="button"
            variant="outline"
            className="h-8 rounded-lg px-3 text-[0.82rem]"
            onClick={() => router.replace("/search")}
          >
            Start fresh
          </Button>
        </div>
      ) : null}

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <h2 className="text-[1.45rem] font-semibold tracking-[-0.03em]">Import verified followers</h2>
          <p className="mt-1.5 text-[0.98rem] text-muted-foreground">
            Import an X account&apos;s verified followers directly into your leads.
          </p>
        </div>

        <div className="space-y-2">
          <label className="block text-[1.05rem] font-semibold">X handle</label>
          <Input
            className="h-[42px] items-center rounded-[10px] text-[1rem]"
            placeholder="@MarkKnd"
            value={networkUsername}
            onChange={(event) => setNetworkUsername(event.target.value)}
            required
          />
        </div>

        <Button
          type="submit"
          variant="outline"
          className="h-[42px] w-full rounded-[10px] text-[1rem] font-medium"
          disabled={importMutation.isPending}
        >
          {importMutation.isPending ? <Spinner className="size-4" /> : null}
          {importMutation.isPending ? "Importing..." : "Import Verified Followers"}
        </Button>
      </form>

      <ReasoningSheet
        open={reasoningOpen}
        onOpenChange={setReasoningOpen}
        title="Network Import Reasoning"
        description="Watching seed resolution, graph import, and final spreadsheet insert."
        isPending={importMutation.isPending}
        liveSteps={NETWORK_REASONING_STEPS}
        trace={reasoningTrace}
      />
    </>
  );
}
