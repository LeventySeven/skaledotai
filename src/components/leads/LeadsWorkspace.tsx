"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FolderPlusIcon, RefreshCwIcon, Trash2Icon, UsersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toastManager } from "@/components/ui/toast";
import { LeadDetailSheet } from "@/components/leads/LeadDetailSheet";
import { trpc } from "@/lib/trpc/client";
import type { Lead } from "@/lib/types";

const PAGE_SIZE = 25;

function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function toPatchInput(patch: Partial<Lead>) {
  const payload: {
    stage?: Lead["stage"];
    priority?: Lead["priority"];
    dmComfort?: boolean;
    theAsk?: string;
    inOutreach?: boolean;
    email?: string | null;
    budget?: number | null;
  } = {};

  if ("stage" in patch) payload.stage = patch.stage;
  if ("priority" in patch) payload.priority = patch.priority;
  if ("dmComfort" in patch) payload.dmComfort = patch.dmComfort;
  if ("theAsk" in patch) payload.theAsk = patch.theAsk;
  if ("inOutreach" in patch) payload.inOutreach = patch.inOutreach;
  if ("email" in patch) payload.email = patch.email ?? null;
  if ("budget" in patch) payload.budget = patch.budget ?? null;

  return payload;
}

export function LeadsWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const utils = trpc.useUtils();
  const { data: projects = [] } = trpc.projects.list.useQuery();
  const projectParam = searchParams.get("project") ?? "";
  const [projectId, setProjectId] = useState(projectParam);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<"followers-desc" | "followers-asc" | "name-asc">("followers-desc");
  const [stage, setStage] = useState<"all" | "found" | "messaged" | "replied" | "agreed">("all");
  const [outreachFilter, setOutreachFilter] = useState<"all" | "queued" | "not-queued">("all");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    setProjectId(projectParam);
    setPage(1);
  }, [projectParam]);

  const listQuery = trpc.leads.list.useQuery({
    page,
    pageSize: PAGE_SIZE,
    projectId: projectId || undefined,
    search: deferredSearch,
    sort,
    stage,
    inOutreach:
      outreachFilter === "all"
        ? undefined
        : outreachFilter === "queued",
  });

  const updateLead = trpc.leads.update.useMutation({
    onSuccess: async (lead) => {
      setSelectedLead((current) => (current?.id === lead.id ? { ...current, ...lead } : current));
      await Promise.all([
        utils.leads.list.invalidate(),
        utils.outreach.list.invalidate(),
      ]);
    },
    onError: (error) => {
      toastManager.add({ type: "error", title: error.message });
    },
  });

  const removeLead = trpc.leads.remove.useMutation({
    onSuccess: async () => {
      setSheetOpen(false);
      setSelectedLead(null);
      await Promise.all([
        utils.leads.list.invalidate(),
        utils.outreach.list.invalidate(),
        utils.projects.list.invalidate(),
      ]);
      toastManager.add({ type: "success", title: "Lead removed." });
    },
    onError: (error) => {
      toastManager.add({ type: "error", title: error.message });
    },
  });

  const queueProject = trpc.projects.queueAllLeads.useMutation({
    onSuccess: async ({ queued }) => {
      await Promise.all([
        utils.leads.list.invalidate(),
        utils.outreach.list.invalidate(),
      ]);
      toastManager.add({
        type: "success",
        title: queued > 0 ? `Queued ${queued} leads for outreach.` : "All project leads are already queued.",
      });
    },
    onError: (error) => {
      toastManager.add({ type: "error", title: error.message });
    },
  });

  const currentProject = useMemo(
    () => projects.find((project) => project.id === projectId),
    [projectId, projects],
  );

  async function handlePatch(id: string, patch: Partial<Lead>) {
    await updateLead.mutateAsync({
      crmId: id,
      patch: toPatchInput(patch),
    });
  }

  function handleProjectFilter(nextProjectId: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextProjectId) {
      params.set("project", nextProjectId);
    } else {
      params.delete("project");
    }
    setPage(1);
    router.replace(`/leads${params.toString() ? `?${params.toString()}` : ""}`);
  }

  const leads = listQuery.data?.leads ?? [];
  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6 p-6 md:p-8">
      <section className="rounded-3xl border bg-card p-6 shadow-sm/5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Lead CRM</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Manage discovered accounts</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Filters and edits stay on the existing leads service. No architecture rewrite, just the missing UI on top of the current tRPC contract.
            </p>
          </div>
          {projectId && (
            <Button
              variant="outline"
              disabled={queueProject.isPending}
              onClick={() => queueProject.mutate({ projectId })}
            >
              {queueProject.isPending ? <Spinner className="size-4" /> : <FolderPlusIcon className="size-4" />}
              {queueProject.isPending ? "Queueing..." : `Queue ${currentProject?.name ?? "project"}`}
            </Button>
          )}
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-6 shadow-sm/5">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,0.8fr))]">
          <Input
            placeholder="Search name or handle"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
          <select
            className="flex h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={projectId}
            onChange={(event) => handleProjectFilter(event.target.value)}
          >
            <option value="">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <select
            className="flex h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={stage}
            onChange={(event) => {
              setStage(event.target.value as typeof stage);
              setPage(1);
            }}
          >
            <option value="all">All stages</option>
            <option value="found">Found</option>
            <option value="messaged">Messaged</option>
            <option value="replied">Replied</option>
            <option value="agreed">Agreed</option>
          </select>
          <select
            className="flex h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={outreachFilter}
            onChange={(event) => {
              setOutreachFilter(event.target.value as typeof outreachFilter);
              setPage(1);
            }}
          >
            <option value="all">All outreach states</option>
            <option value="queued">In outreach</option>
            <option value="not-queued">Not in outreach</option>
          </select>
          <select
            className="flex h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={sort}
            onChange={(event) => setSort(event.target.value as typeof sort)}
          >
            <option value="followers-desc">Followers desc</option>
            <option value="followers-asc">Followers asc</option>
            <option value="name-asc">Name</option>
          </select>
        </div>
      </section>

      <section className="rounded-2xl border bg-card shadow-sm/5">
        {listQuery.isLoading ? (
          <div className="flex items-center justify-center p-10 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            <span className="ml-2">Loading leads...</span>
          </div>
        ) : leads.length === 0 ? (
          <Empty className="py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UsersIcon />
              </EmptyMedia>
              <EmptyTitle>No leads found</EmptyTitle>
              <EmptyDescription>
                Run a search first, or relax the current filters.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lead</TableHead>
                  <TableHead>Followers</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Outreach</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((lead) => (
                  <TableRow
                    key={lead.id}
                    className="cursor-pointer"
                    onClick={() => {
                      setSelectedLead(lead);
                      setSheetOpen(true);
                    }}
                  >
                    <TableCell className="min-w-0">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{lead.name}</p>
                        <p className="truncate text-sm text-muted-foreground">@{lead.handle}</p>
                      </div>
                    </TableCell>
                    <TableCell>{formatNumber(lead.followers)}</TableCell>
                    <TableCell>
                      <Badge variant={lead.priority === "P0" ? "warning" : "outline"}>
                        {lead.priority}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{lead.stage}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={lead.inOutreach ? "success" : "outline"}>
                        {lead.inOutreach ? "Queued" : "Not queued"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={(event) => {
                            event.stopPropagation();
                            handlePatch(lead.id, { inOutreach: !lead.inOutreach }).catch(() => undefined);
                          }}
                        >
                          <RefreshCwIcon className="size-3.5" />
                          {lead.inOutreach ? "Unqueue" : "Queue"}
                        </Button>
                        <Button
                          size="xs"
                          variant="destructive-outline"
                          onClick={(event) => {
                            event.stopPropagation();
                            removeLead.mutate({ crmId: lead.id });
                          }}
                        >
                          <Trash2Icon className="size-3.5" />
                          Remove
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex flex-col gap-4 border-t px-6 py-4 md:flex-row md:items-center md:justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, total)} of {total} leads
              </p>
              <Pagination className="mx-0 w-auto justify-start md:justify-end">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      href="#"
                      onClick={(event) => {
                        event.preventDefault();
                        setPage((current) => Math.max(1, current - 1));
                      }}
                      className={page === 1 ? "pointer-events-none opacity-50" : undefined}
                    />
                  </PaginationItem>
                  {Array.from({ length: totalPages }, (_, index) => index + 1)
                    .slice(Math.max(0, page - 2), Math.max(0, page - 2) + 3)
                    .map((pageNumber) => (
                      <PaginationItem key={pageNumber}>
                        <PaginationLink
                          href="#"
                          isActive={pageNumber === page}
                          onClick={(event) => {
                            event.preventDefault();
                            setPage(pageNumber);
                          }}
                        >
                          {pageNumber}
                        </PaginationLink>
                      </PaginationItem>
                    ))}
                  <PaginationItem>
                    <PaginationNext
                      href="#"
                      onClick={(event) => {
                        event.preventDefault();
                        setPage((current) => Math.min(totalPages, current + 1));
                      }}
                      className={page === totalPages ? "pointer-events-none opacity-50" : undefined}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          </>
        )}
      </section>

      <LeadDetailSheet
        lead={selectedLead}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onPatch={handlePatch}
        niche={currentProject?.query}
      />
    </div>
  );
}
