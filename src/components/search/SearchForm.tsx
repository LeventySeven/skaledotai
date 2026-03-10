"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { XDataProviderSelector } from "@/components/providers/XDataProviderSelector";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { trpc } from "@/lib/trpc/client";

const FOLLOWER_FLOOR_OPTIONS = [
  { label: "Any size", value: 0 },
  { label: "500+", value: 500 },
  { label: "1k+", value: 1_000 },
  { label: "5k+", value: 5_000 },
  { label: "10k+", value: 10_000 },
  { label: "50k+", value: 50_000 },
  { label: "100k+", value: 100_000 },
] as const;

export function SearchForm() {
  const router = useRouter();
  const { data: projects = [] } = trpc.projects.list.useQuery();
  const utils = trpc.useUtils();
  const [query, setQuery] = useState("");
  const [projectMode, setProjectMode] = useState<"new" | "existing">("new");
  const [projectId, setProjectId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [searchFollowersOnly, setSearchFollowersOnly] = useState(false);
  const [followerUsername, setFollowerUsername] = useState("");
  const [minFollowers, setMinFollowers] = useState(1_000);

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
      router.push(`/leads?project=${result.project.id}`);
    },
    onError: (error) => {
      toastManager.add({ type: "error", title: error.message });
    },
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query.trim()) return;

    if (searchFollowersOnly && !followerUsername.trim()) {
      toastManager.add({ type: "error", title: "Enter an X handle to search within followers." });
      return;
    }

    await searchMutation.mutateAsync({
      query: query.trim(),
      projectId: projectMode === "existing" ? projectId || undefined : undefined,
      projectName: projectMode === "new" ? projectName.trim() || query.trim() : undefined,
      followerUsername:
        searchFollowersOnly && followerUsername.trim()
          ? followerUsername.replace(/^@/, "").trim()
          : undefined,
      minFollowers,
    });
  }

  return (
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
        ) : (
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
        )}
      </div>

      <div className="grid gap-5 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
        <div className="space-y-2">
          <label className="block text-[1.05rem] font-semibold">X data source</label>
          <XDataProviderSelector showHint={false} />
          <p className="text-[0.95rem] text-muted-foreground">
            The selected provider is global and applies to search, imports, stats, and AI analysis.
          </p>
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
        disabled={searchMutation.isPending}
      >
        {searchMutation.isPending ? <Spinner className="size-4" /> : null}
        {searchMutation.isPending ? "Running Search" : "Run Search"}
      </Button>
    </form>
  );
}
