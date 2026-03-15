"use client";

import { type FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useXDataProviderPreference } from "@/components/providers/XDataProviderPreference";
import { XDataSourceSummaryCard } from "@/components/providers/XDataSourceSummaryCard";
import { SearchRunTracePanel } from "./SearchRunTracePanel";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { trpc } from "@/lib/trpc/client";
import type { ProjectRunTrace, ProjectRunTraceStep } from "@/lib/validations/project-runs";
import {
  SearchRunStreamEventSchema,
  type SearchRunStreamSnapshot,
} from "@/lib/validations/search";
import {
  FOLLOWER_FLOOR_OPTIONS,
  LEAD_TARGET_BOUNDS,
  mergeTraceSteps,
  readErrorMessage,
  normalizeLiveStreamError,
  getLiveMultiAgentStreamTarget,
} from "./search-helpers";

export function SearchForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isImportRerun = searchParams.has("importUsername");
  const rerunProjectId = isImportRerun ? null : searchParams.get("project");
  const rerunQuery = searchParams.get("query");
  const rerunMinFollowers = searchParams.get("minFollowers");
  const rerunTargetLeadCount = searchParams.get("targetLeadCount");
  const utils = trpc.useUtils();
  const { provider } = useXDataProviderPreference();
  const [query, setQuery] = useState(rerunQuery ?? "");
  const [searchFollowersOnly, setSearchFollowersOnly] = useState(false);
  const [followerUsername, setFollowerUsername] = useState("");
  const [minFollowers, setMinFollowers] = useState(rerunMinFollowers ? Number(rerunMinFollowers) : 1_000);
  const [targetLeadCount, setTargetLeadCount] = useState(rerunTargetLeadCount ?? "100");
  const [liveSearchPending, setLiveSearchPending] = useState(false);
  const [streamSteps, setStreamSteps] = useState<ProjectRunTraceStep[]>([]);
  const [streamSnapshot, setStreamSnapshot] = useState<SearchRunStreamSnapshot | null>(null);
  const [streamTrace, setStreamTrace] = useState<ProjectRunTrace | null>(null);

  const searchMutation = trpc.search.run.useMutation({
    onSuccess: async (result) => {
      await Promise.all([
        utils.projects.list.invalidate(),
        utils.leads.list.invalidate(),
      ]);
      toastManager.add({
        type: "success",
        title: `Added ${result.leads.length} leads to ${result.project.name}.`,
      });
      window.setTimeout(() => {
        router.push(`/leads?project=${result.project.id}`);
      }, 350);
    },
    onError: (error) => {
      toastManager.add({ type: "error", title: error.message });
    },
  });

  async function runLiveMultiAgentSearch(payload: {
    query: string;
    projectId?: string;
    projectName?: string;
    followerUsername?: string;
    minFollowers: number;
    targetLeadCount: number;
  }) {
    setLiveSearchPending(true);
    setStreamSteps([]);
    setStreamSnapshot(null);
    setStreamTrace(null);

    try {
      const target = await getLiveMultiAgentStreamTarget(provider);
      const response = await fetch(target.streamUrl, {
        method: "POST",
        credentials: target.streamUrl.startsWith("/") ? "include" : "omit",
        headers: target.headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok || !response.body) {
        throw new Error(await readErrorMessage(response));
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;

      const handleEventLine = async (line: string): Promise<boolean> => {
        const trimmed = line.trim();
        if (!trimmed) return false;

        const event = SearchRunStreamEventSchema.parse(JSON.parse(trimmed));
        if (event.type === "step") {
          setStreamSteps((current) => current.some((step) => step.id === event.step.id)
            ? current
            : [...current, event.step]);
          return false;
        }

        if (event.type === "snapshot") {
          setStreamSnapshot(event.snapshot);
          return false;
        }

        if (event.type === "complete") {
          completed = true;
          setStreamTrace(event.result.trace);
          setStreamSteps((current) => mergeTraceSteps(current, event.result.trace.steps));
          await Promise.all([
            utils.projects.list.invalidate(),
            utils.leads.list.invalidate(),
          ]);
          toastManager.add({
            type: "success",
            title: `Added ${event.result.leads.length} leads to ${event.result.project.name}.`,
          });
          window.setTimeout(() => {
            router.push(`/leads?project=${event.result.project.id}`);
          }, 350);
          return true;
        }

        throw new Error(event.message);
      };

      try {
        while (true) {
          let chunk;
          try {
            chunk = await reader.read();
          } catch (error) {
            throw normalizeLiveStreamError(error);
          }

          const { done, value } = chunk;
          buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (await handleEventLine(line)) return;
          }

          if (done) break;
        }

        if (buffer.trim() && await handleEventLine(buffer)) return;
        if (!completed) {
          throw new Error("Live search ended before the multi-agent run completed.");
        }
      } finally {
        reader.releaseLock();
      }
    } finally {
      setLiveSearchPending(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query.trim()) return;

    if (searchFollowersOnly && !followerUsername.trim()) {
      toastManager.add({ type: "error", title: "Enter an X handle to search within followers." });
      return;
    }

    const payload = {
      query: query.trim(),
      projectId: rerunProjectId ?? undefined,
      projectName: rerunProjectId ? undefined : query.trim(),
      followerUsername:
        searchFollowersOnly && followerUsername.trim()
          ? followerUsername.trim().replace(/^https?:\/\/(www\.)?(x\.com|twitter\.com)\//i, "").replace(/^@/, "").replace(/\/.*$/, "").trim()
          : undefined,
      minFollowers,
      targetLeadCount: Math.max(
        LEAD_TARGET_BOUNDS.min,
        Math.min(LEAD_TARGET_BOUNDS.max, Number(targetLeadCount) || LEAD_TARGET_BOUNDS.min),
      ),
    };

    if (provider === "multiagent") {
      try {
        await runLiveMultiAgentSearch(payload);
      } catch (error) {
        setStreamTrace(null);
        setStreamSteps([]);
        setStreamSnapshot(null);
        toastManager.add({
          type: "error",
          title: error instanceof Error ? error.message : "Live search failed.",
        });
      }
      return;
    }

    await searchMutation.mutateAsync(payload);
  }

  return (
    <>
      {rerunProjectId ? (
        <div className="mt-8 mb-2 flex items-center justify-between rounded-[10px] border border-border px-3.5 py-2.5">
          <span className="text-[0.88rem] text-muted-foreground">Re-running into existing campaign</span>
          <Button
            type="button"
            variant="outline"
            className="h-8 rounded-[10px] px-3 text-[0.88rem]"
            onClick={() => router.replace("/search")}
          >
            Start fresh
          </Button>
        </div>
      ) : null}

      <form className={`${rerunProjectId ? "mt-4" : "mt-8"} space-y-7`} onSubmit={handleSubmit}>
        <div className="space-y-2">
          <label className="block text-[1.05rem] font-semibold">What are you looking for?</label>
          <Input
            className="h-[42px] items-center rounded-[10px] text-[1rem]"
            placeholder="e.g. best product designers"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            required
          />
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          <div className="space-y-2">
            <label className="block text-[1.05rem] font-semibold">Data source</label>
            <XDataSourceSummaryCard />
          </div>
          <div className="space-y-2">
            <label className="block text-[1.05rem] font-semibold">Minimum followers</label>
            <select
              className="flex h-[42px] w-full rounded-[10px] border border-input bg-background px-4 pr-8 text-[1rem] shadow-xs/5"
              value={minFollowers}
              onChange={(event) => setMinFollowers(Number(event.target.value))}
            >
              {FOLLOWER_FLOOR_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="block text-[1.05rem] font-semibold">Approximate leads <span className="font-normal text-muted-foreground text-sm">(soft target)</span></label>
            <Input
              className="h-[42px] items-center rounded-[10px] text-[1rem]"
              type="number"
              min={LEAD_TARGET_BOUNDS.min}
              max={LEAD_TARGET_BOUNDS.max}
              value={targetLeadCount}
              onChange={(event) => setTargetLeadCount(event.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-3 text-[1rem]">
            <Checkbox
              checked={searchFollowersOnly}
              onCheckedChange={(value) => setSearchFollowersOnly(Boolean(value))}
            />
            Search within a user&apos;s followers
          </label>
          {searchFollowersOnly && (
            <Input
              className="h-[42px] items-center rounded-[10px] text-[1rem]"
              placeholder="@markknd"
              value={followerUsername}
              onChange={(event) => setFollowerUsername(event.target.value)}
            />
          )}
        </div>

        <Button
          type="submit"
          className="h-8 w-full rounded-[10px] text-[0.88rem] font-medium"
          disabled={searchMutation.isPending || liveSearchPending}
        >
          {searchMutation.isPending || liveSearchPending ? <Spinner className="size-4" /> : null}
          {searchMutation.isPending || liveSearchPending ? "Running Search" : "Run Search"}
        </Button>
      </form>

      {provider === "multiagent" && (liveSearchPending || streamSteps.length > 0 || streamTrace) ? (
        <SearchRunTracePanel
          steps={streamSteps.length > 0 ? streamSteps : (streamTrace?.steps ?? [])}
          snapshot={streamSnapshot}
          isPending={liveSearchPending}
          trace={streamTrace}
        />
      ) : null}
    </>
  );
}
