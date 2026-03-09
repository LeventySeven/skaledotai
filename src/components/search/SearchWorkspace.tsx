"use client";

import { type FormEvent, type ReactNode, useState } from "react";
import { useRouter } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

const FOLLOWER_FLOOR_OPTIONS = [
  { label: "Any size", value: 0 },
  { label: "500+", value: 500 },
  { label: "1k+", value: 1_000 },
  { label: "5k+", value: 5_000 },
  { label: "10k+", value: 10_000 },
  { label: "50k+", value: 50_000 },
  { label: "100k+", value: 100_000 },
] as const;

function SegmentedButton({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        "h-[42px] rounded-[12px] px-6 text-[0.98rem] font-medium transition-colors",
        active ? "bg-white text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)]" : "text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function SearchWorkspace() {
  const router = useRouter();
  const { data: projects = [] } = trpc.projects.list.useQuery();
  const [query, setQuery] = useState("");
  const [projectMode, setProjectMode] = useState<"new" | "existing">("new");
  const [projectId, setProjectId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [searchFollowersOnly, setSearchFollowersOnly] = useState(false);
  const [followerUsername, setFollowerUsername] = useState("");
  const [minFollowers, setMinFollowers] = useState(1_000);
  const [networkUsername, setNetworkUsername] = useState("");
  const [networkProjectMode, setNetworkProjectMode] = useState<"new" | "existing">("new");
  const [networkProjectId, setNetworkProjectId] = useState("");
  const [networkProjectName, setNetworkProjectName] = useState("");
  const utils = trpc.useUtils();

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

  const importMutation = trpc.search.importNetwork.useMutation({
    onSuccess: async (result) => {
      await Promise.all([
        utils.projects.list.invalidate(),
        utils.leads.list.invalidate(),
      ]);
      toastManager.add({
        type: "success",
        title: `Imported ${result.leads.length} leads into ${result.project.name}.`,
      });
      router.push(`/leads?project=${result.project.id}`);
    },
    onError: (error) => {
      toastManager.add({ type: "error", title: error.message });
    },
  });

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query.trim()) return;

    if (searchFollowersOnly && !followerUsername.trim()) {
      toastManager.add({
        type: "error",
        title: "Enter an X handle to search within followers.",
      });
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

  async function handleImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanHandle = networkUsername.replace(/^@/, "").trim();
    if (!cleanHandle) return;

    await importMutation.mutateAsync({
      username: cleanHandle,
      projectId: networkProjectMode === "existing" ? networkProjectId || undefined : undefined,
      projectName:
        networkProjectMode === "new"
          ? networkProjectName.trim() || `${cleanHandle} network`
          : undefined,
    });
  }

  return (
    <div className="mx-auto max-w-[1120px] px-8 py-6">
      <div className="max-w-[760px]">
        <h1 className="text-[2.85rem] font-semibold tracking-[-0.04em]">Search</h1>
        <p className="mt-2 text-[1rem] text-muted-foreground">
          Find people in any niche on X/Twitter.
        </p>

        <form className="mt-8 space-y-7" onSubmit={handleSearch}>
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
              <label className="block text-[1.05rem] font-semibold">Platform</label>
              <div className="inline-flex rounded-2xl border border-input bg-muted/40 p-1">
                <SegmentedButton active>X / Twitter</SegmentedButton>
              </div>
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

        <div className="my-8 flex items-center gap-6 text-sm text-muted-foreground">
          <div className="h-px flex-1 bg-border" />
          <span>or</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <form className="space-y-4" onSubmit={handleImport}>
          <div>
            <h2 className="text-[1.45rem] font-semibold tracking-[-0.03em]">Import followers</h2>
            <p className="mt-1.5 text-[0.98rem] text-muted-foreground">
              Import all followers &amp; following from a Twitter account directly into your leads.
            </p>
          </div>

          <div className="space-y-2">
            <label className="block text-[1.05rem] font-semibold">Twitter handle</label>
            <Input
              className="h-[42px] rounded-2xl text-[1rem]"
              placeholder="@MarkKnd"
              value={networkUsername}
              onChange={(event) => setNetworkUsername(event.target.value)}
              required
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <select
              className="flex h-[42px] w-full rounded-2xl border border-input bg-background px-4 text-[1rem] shadow-xs/5"
              value={networkProjectMode}
              onChange={(event) => setNetworkProjectMode(event.target.value as "new" | "existing")}
            >
              <option value="new">Create new project</option>
              <option value="existing">Use existing project</option>
            </select>
            {networkProjectMode === "new" ? (
              <Input
                className="h-[42px] rounded-2xl text-[1rem]"
                placeholder="Project name (optional)"
                value={networkProjectName}
                onChange={(event) => setNetworkProjectName(event.target.value)}
              />
            ) : (
              <select
                className="flex h-[42px] w-full rounded-2xl border border-input bg-background px-4 text-[1rem] shadow-xs/5"
                value={networkProjectId}
                onChange={(event) => setNetworkProjectId(event.target.value)}
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

          <Button
            type="submit"
            variant="outline"
            className="h-[42px] w-full rounded-2xl text-[1rem] font-medium"
            disabled={importMutation.isPending}
          >
            {importMutation.isPending ? <Spinner className="size-4" /> : null}
            {importMutation.isPending ? "Importing Followers" : "Import Followers"}
          </Button>
        </form>
      </div>
    </div>
  );
}
