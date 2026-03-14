"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useXDataProviderPreference } from "@/components/providers/XDataProviderPreference";
import { XDataSourceSummaryCard } from "@/components/providers/XDataSourceSummaryCard";
import { SearchRunTracePanel } from "./SearchRunTracePanel";
import { Spinner } from "@/components/ui/spinner";
import { XLogoIcon } from "@/components/ui/x-icon";
import { toastManager } from "@/components/ui/toast";
import { trpc } from "@/lib/trpc/client";
import type { ProjectRunTrace, ProjectRunTraceStep } from "@/lib/validations/project-runs";
import { MultiAgentServiceSessionSchema } from "@/lib/validations/multiagent-service";
import {
  SearchRunStreamEventSchema,
  type SearchRunStreamSnapshot,
} from "@/lib/validations/search";
import type { XDataProvider } from "@/lib/x";

const FOLLOWER_FLOOR_OPTIONS = [
  { label: "Any size", value: 0 },
  { label: "500+", value: 500 },
  { label: "1k+", value: 1_000 },
  { label: "5k+", value: 5_000 },
  { label: "10k+", value: 10_000 },
  { label: "50k+", value: 50_000 },
  { label: "100k+", value: 100_000 },
] as const;

const LEAD_TARGET_BOUNDS = {
  min: 20,
  max: 180,
  step: 10,
} as const;

function mergeTraceSteps(
  current: ProjectRunTraceStep[],
  incoming: ProjectRunTraceStep[],
): ProjectRunTraceStep[] {
  if (current.length === 0) return incoming;
  if (incoming.length === 0) return current;

  const merged = new Map<string, ProjectRunTraceStep>();

  for (const step of current) {
    merged.set(step.id, step);
  }
  for (const step of incoming) {
    merged.set(step.id, step);
  }

  const ordered = [...current];
  for (const step of incoming) {
    if (current.some((existing) => existing.id === step.id)) continue;
    ordered.push(step);
  }

  return ordered.map((step) => merged.get(step.id) ?? step);
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { error?: { message?: string } };
    if (payload.error?.message) return payload.error.message;
  } catch {
    // Fall back to text parsing below.
  }

  const text = await response.text().catch(() => "");
  return text.trim() || "Live search failed.";
}

function normalizeLiveStreamError(error: unknown): Error {
  if (error instanceof Error && error.message.trim().length > 0) {
    if (/input stream/i.test(error.message)) {
      return new Error("Live search stream disconnected before the multi-agent run finished.");
    }
    return error;
  }

  return new Error("Live search stream disconnected before the multi-agent run finished.");
}

async function getLiveMultiAgentStreamTarget(provider: XDataProvider): Promise<{
  streamUrl: string;
  headers: Record<string, string>;
}> {
  const response = await fetch("/api/multiagent/session", {
    method: "POST",
    credentials: "include",
    headers: {
      "x-data-provider": provider,
    },
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  const session = MultiAgentServiceSessionSchema.parse(await response.json());
  if (session.mode === "external") {
    return {
      streamUrl: session.streamUrl,
      headers: {
        authorization: `Bearer ${session.token}`,
        "content-type": "application/json",
      },
    };
  }

  return {
    streamUrl: session.streamUrl,
    headers: {
      "content-type": "application/json",
      "x-data-provider": provider,
    },
  };
}

export function SearchForm() {
  const router = useRouter();
  const { data: projects = [] } = trpc.projects.list.useQuery();
  const utils = trpc.useUtils();
  const { provider } = useXDataProviderPreference();
  const [query, setQuery] = useState("");
  const [projectMode, setProjectMode] = useState<"new" | "existing">("new");
  const [projectId, setProjectId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [searchFollowersOnly, setSearchFollowersOnly] = useState(false);
  const [followerUsername, setFollowerUsername] = useState("");
  const [minFollowers, setMinFollowers] = useState(1_000);
  const [targetLeadCount, setTargetLeadCount] = useState(100);
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
      projectId: projectMode === "existing" ? projectId || undefined : undefined,
      projectName: projectMode === "new" ? projectName.trim() || query.trim() : undefined,
      followerUsername:
        searchFollowersOnly && followerUsername.trim()
          ? followerUsername.replace(/^@/, "").trim()
          : undefined,
      minFollowers,
      targetLeadCount: Math.max(
        LEAD_TARGET_BOUNDS.min,
        Math.min(LEAD_TARGET_BOUNDS.max, targetLeadCount),
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
      <form className="mt-8 space-y-7" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <label className="block text-[1.05rem] font-semibold">What are you looking for?</label>
          <Input
            className="h-[42px] rounded-2xl text-[1rem]"
            placeholder="e.g. best product designers"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            required
          />
        </div>

        <div className="space-y-2">
          <label className="block text-[1.05rem] font-semibold">
            Project <span className="ml-2 font-normal text-muted-foreground">(optional)</span>
          </label>
          <select
            className="flex h-[42px] w-full rounded-2xl border border-input bg-background px-4 text-[1rem] shadow-xs/5"
            value={projectMode}
            onChange={(event) => setProjectMode(event.target.value as "new" | "existing")}
          >
            <option value="new">Create new project</option>
            <option value="existing">Use existing project</option>
          </select>
          {projectMode === "new" ? (
            <>
              <Input
                className="h-[42px] rounded-2xl text-[1rem]"
                placeholder="e.g. Designers campaign"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
              />
              <p className="text-[0.95rem] text-muted-foreground">
                A new project will be created. Defaults to the search query.
              </p>
            </>
          ) : null}
        </div>

        {projectMode === "existing" ? (
          <select
            className="flex h-[42px] w-full rounded-2xl border border-input bg-background px-4 text-[1rem] shadow-xs/5"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            required
          >
            <option value="">Select project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        ) : null}

        <div className="grid gap-5 md:grid-cols-[minmax(0,270px)_minmax(0,1fr)_minmax(0,180px)]">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[1.05rem] font-semibold"><XLogoIcon className="size-4" /> data source</label>
            <XDataSourceSummaryCard />
          </div>
          <div className="space-y-2">
            <label className="block text-[1.05rem] font-semibold">Minimum followers</label>
            <select
              className="flex h-[42px] w-full rounded-2xl border border-input bg-background px-4 text-[1rem] shadow-xs/5"
              value={minFollowers}
              onChange={(event) => setMinFollowers(Number(event.target.value))}
            >
              {FOLLOWER_FLOOR_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-[0.95rem] text-muted-foreground">
              X returns `public_metrics.followers_count`; results are filtered and biased toward larger accounts.
            </p>
          </div>
          <div className="space-y-2">
            <label className="block text-[1.05rem] font-semibold">Approximate leads</label>
            <Input
              className="h-[42px] rounded-2xl text-[1rem]"
              type="number"
              min={LEAD_TARGET_BOUNDS.min}
              max={LEAD_TARGET_BOUNDS.max}
              step={LEAD_TARGET_BOUNDS.step}
              value={targetLeadCount}
              onChange={(event) => {
                const nextValue = Number(event.target.value);
                if (Number.isNaN(nextValue)) return;
                setTargetLeadCount(nextValue);
              }}
            />
            <p className="text-[0.95rem] text-muted-foreground">
              Multi-agent search treats this as a bounded goal and keeps iterating until it gets close or exhausts the retry window.
            </p>
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
              className="h-[42px] rounded-2xl text-[1rem]"
              placeholder="@markknd"
              value={followerUsername}
              onChange={(event) => setFollowerUsername(event.target.value)}
            />
          )}
        </div>

        <Button
          type="submit"
          className="h-[42px] w-full rounded-2xl text-[1rem] font-medium"
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
