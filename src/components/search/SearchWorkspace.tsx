"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { SearchIcon, SparklesIcon, UsersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import { trpc } from "@/lib/trpc/client";
import type { Lead } from "@/lib/types";

function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

type SearchResultState = {
  projectId: string;
  projectName: string;
  leads: Lead[];
};

export function SearchWorkspace() {
  const utils = trpc.useUtils();
  const { data: projects = [] } = trpc.projects.list.useQuery();
  const [query, setQuery] = useState("");
  const [followerUsername, setFollowerUsername] = useState("");
  const [searchProjectMode, setSearchProjectMode] = useState<"new" | "existing">("new");
  const [searchProjectId, setSearchProjectId] = useState("");
  const [searchProjectName, setSearchProjectName] = useState("");
  const [networkUsername, setNetworkUsername] = useState("");
  const [networkProjectMode, setNetworkProjectMode] = useState<"new" | "existing">("new");
  const [networkProjectId, setNetworkProjectId] = useState("");
  const [networkProjectName, setNetworkProjectName] = useState("");
  const [lastRun, setLastRun] = useState<SearchResultState | null>(null);

  const searchMutation = trpc.search.run.useMutation({
    onSuccess: async (result) => {
      setLastRun({
        projectId: result.project.id,
        projectName: result.project.name,
        leads: result.leads,
      });
      await Promise.all([
        utils.projects.list.invalidate(),
        utils.leads.list.invalidate(),
      ]);
      toastManager.add({
        type: "success",
        title: `Added ${result.leads.length} leads to ${result.project.name}.`,
      });
    },
    onError: (error) => {
      toastManager.add({ type: "error", title: error.message });
    },
  });

  const importMutation = trpc.search.importNetwork.useMutation({
    onSuccess: async (result) => {
      setLastRun({
        projectId: result.project.id,
        projectName: result.project.name,
        leads: result.leads,
      });
      await Promise.all([
        utils.projects.list.invalidate(),
        utils.leads.list.invalidate(),
      ]);
      toastManager.add({
        type: "success",
        title: `Imported ${result.leads.length} accounts into ${result.project.name}.`,
      });
    },
    onError: (error) => {
      toastManager.add({ type: "error", title: error.message });
    },
  });

  async function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await searchMutation.mutateAsync({
      query: query.trim(),
      followerUsername: followerUsername.trim() || undefined,
      projectId: searchProjectMode === "existing" ? searchProjectId || undefined : undefined,
      projectName:
        searchProjectMode === "new"
          ? searchProjectName.trim() || query.trim()
          : undefined,
    });
  }

  async function handleNetworkImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanHandle = networkUsername.replace(/^@/, "").trim();
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
    <div className="space-y-8 p-6 md:p-8">
      <section className="rounded-3xl border bg-card p-6 shadow-sm/5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Lead discovery</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Search X and import networks</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              The architecture stays the same: tRPC calls the service layer, the service layer uses X API plus OpenAI, and results land in the existing projects and leads tables.
            </p>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline" className="gap-1">
              <UsersIcon className="size-3.5" />
              X API
            </Badge>
            <Badge variant="outline" className="gap-1">
              <SparklesIcon className="size-3.5" />
              OpenAI
            </Badge>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-2xl border bg-card p-6 shadow-sm/5">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">Topical search</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Search profiles, recent posts, replies, and optionally a seed account network.
            </p>
          </div>

          <form className="space-y-4" onSubmit={handleSearchSubmit}>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="query">Query</label>
              <Input
                id="query"
                placeholder="e.g. ai creator tools"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="followerUsername">Seed handle (optional)</label>
              <Input
                id="followerUsername"
                placeholder="@openai"
                value={followerUsername}
                onChange={(event) => setFollowerUsername(event.target.value)}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-[160px_minmax(0,1fr)]">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="searchProjectMode">Save into</label>
                <select
                  id="searchProjectMode"
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={searchProjectMode}
                  onChange={(event) => setSearchProjectMode(event.target.value as "new" | "existing")}
                >
                  <option value="new">New project</option>
                  <option value="existing">Existing project</option>
                </select>
              </div>

              {searchProjectMode === "existing" ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="searchProjectId">Project</label>
                  <select
                    id="searchProjectId"
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={searchProjectId}
                    onChange={(event) => setSearchProjectId(event.target.value)}
                    required
                  >
                    <option value="">Select a project</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="searchProjectName">Project name</label>
                  <Input
                    id="searchProjectName"
                    placeholder="Defaults to the search query"
                    value={searchProjectName}
                    onChange={(event) => setSearchProjectName(event.target.value)}
                  />
                </div>
              )}
            </div>

            <Button className="w-full" disabled={searchMutation.isPending}>
              {searchMutation.isPending ? <Spinner className="size-4" /> : <SearchIcon className="size-4" />}
              {searchMutation.isPending ? "Searching..." : "Run search"}
            </Button>
          </form>
        </section>

        <section className="rounded-2xl border bg-card p-6 shadow-sm/5">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">Account network import</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Pull followers plus following for one X account into a project.
            </p>
          </div>

          <form className="space-y-4" onSubmit={handleNetworkImport}>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="networkUsername">X handle</label>
              <Input
                id="networkUsername"
                placeholder="@openai"
                value={networkUsername}
                onChange={(event) => setNetworkUsername(event.target.value)}
                required
              />
            </div>

            <div className="grid gap-4 md:grid-cols-[160px_minmax(0,1fr)]">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="networkProjectMode">Save into</label>
                <select
                  id="networkProjectMode"
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={networkProjectMode}
                  onChange={(event) => setNetworkProjectMode(event.target.value as "new" | "existing")}
                >
                  <option value="new">New project</option>
                  <option value="existing">Existing project</option>
                </select>
              </div>

              {networkProjectMode === "existing" ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="networkProjectId">Project</label>
                  <select
                    id="networkProjectId"
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={networkProjectId}
                    onChange={(event) => setNetworkProjectId(event.target.value)}
                    required
                  >
                    <option value="">Select a project</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="networkProjectName">Project name</label>
                  <Input
                    id="networkProjectName"
                    placeholder="Defaults to @handle network"
                    value={networkProjectName}
                    onChange={(event) => setNetworkProjectName(event.target.value)}
                  />
                </div>
              )}
            </div>

            <Button className="w-full" variant="outline" disabled={importMutation.isPending}>
              {importMutation.isPending ? <Spinner className="size-4" /> : <UsersIcon className="size-4" />}
              {importMutation.isPending ? "Importing..." : "Import network"}
            </Button>
          </form>
        </section>
      </div>

      <section className="rounded-2xl border bg-card p-6 shadow-sm/5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Latest run</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Newly added leads from the most recent search or network import.
            </p>
          </div>
          {lastRun && (
            <Button render={<Link href={`/leads?project=${lastRun.projectId}`} />} variant="outline">
              Open {lastRun.projectName}
            </Button>
          )}
        </div>

        {!lastRun ? (
          <Empty className="py-14">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchIcon />
              </EmptyMedia>
              <EmptyTitle>No search run yet</EmptyTitle>
              <EmptyDescription>
                Run a topical search or import an account network to populate leads.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : lastRun.leads.length === 0 ? (
          <Empty className="py-14">
            <EmptyHeader>
              <EmptyTitle>No leads found</EmptyTitle>
              <EmptyDescription>
                The request completed, but no qualifying profiles were returned.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {lastRun.leads.slice(0, 12).map((lead) => (
              <div key={lead.id} className="rounded-xl border bg-background p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{lead.name}</p>
                    <p className="text-sm text-muted-foreground">@{lead.handle}</p>
                  </div>
                  <Badge variant={lead.priority === "P0" ? "warning" : "outline"}>
                    {lead.priority}
                  </Badge>
                </div>
                <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">{lead.bio || "No bio available."}</p>
                <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{formatNumber(lead.followers)} followers</span>
                  <span>{lead.discoverySource?.replaceAll("_", " ") ?? "import"}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {lastRun && (
          <EmptyContent className="mt-6 max-w-none items-start text-left">
            <p className="text-sm text-muted-foreground">
              Project <span className="font-medium text-foreground">{lastRun.projectName}</span> now has {lastRun.leads.length} newly added leads from the latest run.
            </p>
          </EmptyContent>
        )}
      </section>
    </div>
  );
}
