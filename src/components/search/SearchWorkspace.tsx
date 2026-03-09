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
    <div className="mx-auto max-w-[1260px] px-9 py-10">
      <div className="max-w-[780px]">
        <h1 className="text-[3.15rem] font-semibold tracking-[-0.04em]">Search</h1>
        <p className="mt-3 text-[1.05rem] text-muted-foreground">
          Find people in any niche on X/Twitter.
        </p>

        <form className="mt-12 space-y-12" onSubmit={handleSearch}>
          <div className="space-y-3">
            <label className="block text-[1.05rem] font-semibold">What are you looking for?</label>
            <Input
              className="h-[44px] rounded-2xl text-[1rem]"
              placeholder="e.g. best product designers"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              required
            />
          </div>

          <div className="space-y-3">
            <label className="block text-[1.05rem] font-semibold">
              Project <span className="ml-2 font-normal text-muted-foreground">(optional)</span>
            </label>
            <select
              className="flex h-[44px] w-full rounded-2xl border border-input bg-background px-4 text-[1rem] shadow-xs/5"
              value={projectMode}
              onChange={(event) => setProjectMode(event.target.value as "new" | "existing")}
            >
              <option value="new">Create new project</option>
              <option value="existing">Use existing project</option>
            </select>
            {projectMode === "new" ? (
              <>
                <Input
                  className="h-[44px] rounded-2xl text-[1rem]"
                  placeholder="e.g. Designers campaign"
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                />
                <p className="text-[0.98rem] text-muted-foreground">
                  A new project will be created. Defaults to the search query.
                </p>
              </>
            ) : (
              <select
                className="flex h-[44px] w-full rounded-2xl border border-input bg-background px-4 text-[1rem] shadow-xs/5"
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

          <div className="space-y-4">
            <label className="block text-[1.05rem] font-semibold">Platform</label>
            <div className="inline-flex rounded-2xl border border-input bg-muted/40 p-1">
              <SegmentedButton active>X / Twitter</SegmentedButton>
            </div>
          </div>

          <div className="space-y-3">
            <label className="flex items-center gap-3 text-[1rem]">
              <Checkbox
                checked={searchFollowersOnly}
                onCheckedChange={(value) => setSearchFollowersOnly(Boolean(value))}
              />
              Search within a user&apos;s followers
            </label>
            {searchFollowersOnly && (
              <Input
                className="h-[44px] rounded-2xl text-[1rem]"
                placeholder="@markknd"
                value={followerUsername}
                onChange={(event) => setFollowerUsername(event.target.value)}
              />
            )}
          </div>

          <Button
            type="submit"
            className="h-[44px] w-full rounded-2xl text-[1rem] font-medium"
            disabled={searchMutation.isPending}
          >
            {searchMutation.isPending ? <Spinner className="size-4" /> : null}
            {searchMutation.isPending ? "Running Search" : "Run Search"}
          </Button>
        </form>

        <div className="my-14 flex items-center gap-6 text-sm text-muted-foreground">
          <div className="h-px flex-1 bg-border" />
          <span>or</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <form className="space-y-5" onSubmit={handleImport}>
          <div>
            <h2 className="text-[1.8rem] font-semibold tracking-[-0.03em]">Import followers</h2>
            <p className="mt-2 text-[1rem] text-muted-foreground">
              Import all followers &amp; following from a Twitter account directly into your leads.
            </p>
          </div>

          <div className="space-y-3">
            <label className="block text-[1.05rem] font-semibold">Twitter handle</label>
            <Input
              className="h-[44px] rounded-2xl text-[1rem]"
              placeholder="@MarkKnd"
              value={networkUsername}
              onChange={(event) => setNetworkUsername(event.target.value)}
              required
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <select
              className="flex h-[44px] w-full rounded-2xl border border-input bg-background px-4 text-[1rem] shadow-xs/5"
              value={networkProjectMode}
              onChange={(event) => setNetworkProjectMode(event.target.value as "new" | "existing")}
            >
              <option value="new">Create new project</option>
              <option value="existing">Use existing project</option>
            </select>
            {networkProjectMode === "new" ? (
              <Input
                className="h-[44px] rounded-2xl text-[1rem]"
                placeholder="Project name (optional)"
                value={networkProjectName}
                onChange={(event) => setNetworkProjectName(event.target.value)}
              />
            ) : (
              <select
                className="flex h-[44px] w-full rounded-2xl border border-input bg-background px-4 text-[1rem] shadow-xs/5"
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
            className="h-[44px] w-full rounded-2xl text-[1rem] font-medium"
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
