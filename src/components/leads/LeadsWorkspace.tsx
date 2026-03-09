"use client";

import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MoreHorizontalIcon, SearchIcon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LeadDetailSheet } from "@/components/leads/LeadDetailSheet";
import { toastManager } from "@/components/ui/toast";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import type { Lead } from "@/lib/types";

const PAGE_SIZE = 10;

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

function isDMed(lead: Lead): boolean {
  return lead.stage === "messaged" || lead.stage === "replied" || lead.stage === "agreed";
}

function isReplied(lead: Lead): boolean {
  return lead.stage === "replied" || lead.stage === "agreed";
}

export function LeadsWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const utils = trpc.useUtils();
  const { data: projects = [] } = trpc.projects.list.useQuery();
  const projectParam = searchParams.get("project") ?? "";
  const [projectId, setProjectId] = useState(projectParam);
  const [page, setPage] = useState(1);
  const [stage, setStage] = useState<"all" | "found" | "messaged" | "replied" | "agreed">("all");
  const [sort, setSort] = useState<"followers-desc" | "followers-asc" | "name-asc">("followers-desc");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    setProjectId(projectParam);
    setPage(1);
    setSelectedIds([]);
  }, [projectParam]);

  const listQuery = trpc.leads.list.useQuery({
    page,
    pageSize: PAGE_SIZE,
    projectId: projectId || undefined,
    search: deferredSearch,
    sort,
    stage,
  });

  const refreshStats = trpc.stats.refresh.useMutation();
  const enrichEmails = trpc.leads.enrichEmails.useMutation();
  const scanEmails = trpc.leads.scanEmails.useMutation();
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

  const leads = listQuery.data?.leads ?? [];
  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentProject = useMemo(
    () => projects.find((project) => project.id === projectId),
    [projectId, projects],
  );

  const allVisibleSelected = leads.length > 0 && leads.every((lead) => selectedIds.includes(lead.id));

  async function handlePatch(id: string, patch: Partial<Lead>) {
    await updateLead.mutateAsync({
      crmId: id,
      patch: toPatchInput(patch),
    });
  }

  function toggleRowSelection(leadId: string, checked: boolean) {
    setSelectedIds((current) =>
      checked ? [...new Set([...current, leadId])] : current.filter((id) => id !== leadId),
    );
  }

  function toggleAllSelection(checked: boolean) {
    setSelectedIds(checked ? leads.map((lead) => lead.id) : []);
  }

  function updateProjectFilter(nextProjectId: string) {
    setProjectId(nextProjectId);
    const params = new URLSearchParams(searchParams.toString());
    if (nextProjectId) params.set("project", nextProjectId);
    else params.delete("project");

    startTransition(() => {
      router.replace(`/leads${params.toString() ? `?${params.toString()}` : ""}`);
    });
  }

  async function handleScanBios() {
    const targetLeads = leads.filter((lead) => selectedIds.length === 0 || selectedIds.includes(lead.id));
    if (targetLeads.length === 0) return;

    for (const lead of targetLeads) {
      await refreshStats.mutateAsync({
        profileId: lead.id,
        crmId: lead.crmId,
        niche: currentProject?.query,
      });
    }

    await Promise.all([
      utils.stats.get.invalidate(),
      utils.leads.list.invalidate(),
    ]);
    toastManager.add({
      type: "success",
      title: `Scanned ${targetLeads.length} bios and refreshed priorities.`,
    });
  }

  async function handleEnrichEmails() {
    if (projectId) {
      const result = await scanEmails.mutateAsync({ projectId });
      await utils.leads.list.invalidate();
      toastManager.add({
        type: "success",
        title: `Enriched ${result.updated} emails in ${currentProject?.name ?? "project"}.`,
      });
      return;
    }

    if (selectedIds.length === 0) {
      toastManager.add({
        type: "info",
        title: "Select leads or open a project first.",
      });
      return;
    }

    const updated = await enrichEmails.mutateAsync({ crmIds: selectedIds });
    await utils.leads.list.invalidate();
    toastManager.add({
      type: "success",
      title: `Enriched ${updated} emails.`,
    });
  }

  return (
    <div className="px-8 py-8">
      <div className="mx-auto max-w-[1680px]">
        <div className="mb-6 flex items-start justify-between gap-6">
          <div>
            <h1 className="text-[3rem] font-semibold tracking-[-0.04em]">
              {currentProject?.name ?? "Leads"}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              className="h-10 rounded-2xl px-5 text-[1rem]"
              disabled={refreshStats.isPending || leads.length === 0}
              onClick={() => {
                handleScanBios().catch((error: unknown) => {
                  toastManager.add({ type: "error", title: error instanceof Error ? error.message : "Scan failed." });
                });
              }}
            >
              {refreshStats.isPending ? <Spinner className="size-4" /> : null}
              {refreshStats.isPending ? "Scanning..." : "Scan Bios"}
            </Button>
            <Button
              variant="outline"
              className="h-10 rounded-2xl px-5 text-[1rem]"
              disabled={enrichEmails.isPending || scanEmails.isPending}
              onClick={() => {
                handleEnrichEmails().catch((error: unknown) => {
                  toastManager.add({ type: "error", title: error instanceof Error ? error.message : "Enrichment failed." });
                });
              }}
            >
              {enrichEmails.isPending || scanEmails.isPending ? <Spinner className="size-4" /> : null}
              Enrich Emails
            </Button>
          </div>
        </div>

        <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row">
            <select
              className="h-12 min-w-[250px] rounded-2xl border border-input bg-background px-4 text-[1rem] shadow-xs/5"
              value={projectId}
              onChange={(event) => updateProjectFilter(event.target.value)}
            >
              <option value="">All Projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>

            <select
              className="h-12 min-w-[220px] rounded-2xl border border-input bg-background px-4 text-[1rem] shadow-xs/5"
              value={stage}
              onChange={(event) => {
                setStage(event.target.value as typeof stage);
                setPage(1);
              }}
            >
              <option value="all">all</option>
              <option value="found">found</option>
              <option value="messaged">messaged</option>
              <option value="replied">replied</option>
              <option value="agreed">agreed</option>
            </select>

            <select
              className="h-12 min-w-[250px] rounded-2xl border border-input bg-background px-4 text-[1rem] shadow-xs/5"
              value={sort}
              onChange={(event) => setSort(event.target.value as typeof sort)}
            >
              <option value="followers-desc">followers-desc</option>
              <option value="followers-asc">followers-asc</option>
              <option value="name-asc">name-asc</option>
            </select>
          </div>

          <Input
            className="h-12 w-full max-w-[305px] rounded-2xl text-[1rem]"
            placeholder="Search leads..."
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </div>

        <div className="overflow-hidden rounded-[1.25rem] border border-border bg-card">
          {listQuery.isLoading ? (
            <div className="flex h-[320px] items-center justify-center text-muted-foreground">
              <Spinner className="size-4" />
              <span className="ml-2">Loading leads...</span>
            </div>
          ) : leads.length === 0 ? (
            <Empty className="min-h-[320px]">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SearchIcon />
                </EmptyMedia>
                <EmptyTitle>No leads found</EmptyTitle>
                <EmptyDescription>
                  Run a search or import an account network to populate this table.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table className="text-[1rem]">
              <TableHeader className="[&_tr]:border-b">
                <TableRow className="h-14 hover:bg-transparent">
                  <TableHead className="w-[56px] px-5">
                    <Checkbox checked={allVisibleSelected} onCheckedChange={(value) => toggleAllSelection(Boolean(value))} />
                  </TableHead>
                  <TableHead className="min-w-[280px]">Name</TableHead>
                  <TableHead className="w-[150px]">Platform</TableHead>
                  <TableHead>Bio</TableHead>
                  <TableHead className="w-[160px]">Followers</TableHead>
                  <TableHead className="w-[130px]">Priority</TableHead>
                  <TableHead className="w-[110px]">DMed</TableHead>
                  <TableHead className="w-[110px]">Replied</TableHead>
                  <TableHead className="w-[130px]">Email</TableHead>
                  <TableHead className="w-[70px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((lead) => (
                  <TableRow key={lead.id} className="h-[78px] border-b" onClick={() => {
                    setSelectedLead(lead);
                    setSheetOpen(true);
                  }}>
                    <TableCell className="px-5" onClick={(event) => event.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.includes(lead.id)}
                        onCheckedChange={(value) => toggleRowSelection(lead.id, Boolean(value))}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-4">
                        <Avatar className="size-11">
                          {lead.avatarUrl ? <AvatarImage src={lead.avatarUrl} alt={lead.name} /> : null}
                          <AvatarFallback>{initials(lead.name)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="truncate text-[1.05rem] font-semibold">{lead.name}</div>
                          <div className="truncate text-muted-foreground">@{lead.handle}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="h-7 rounded-md px-2.5 text-sm font-medium lowercase">
                        x
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[420px]">
                      <div className="truncate text-muted-foreground">{lead.bio || "—"}</div>
                    </TableCell>
                    <TableCell className="text-[1.05rem] font-semibold">{formatFollowers(lead.followers)}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          "h-7 rounded-md border-transparent px-2.5 text-sm font-semibold",
                          lead.priority === "P0" ? "bg-orange-100 text-orange-700" : "bg-muted text-muted-foreground",
                        )}
                      >
                        {lead.priority}
                      </Badge>
                    </TableCell>
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <Checkbox
                        checked={isDMed(lead)}
                        onCheckedChange={(value) => {
                          handlePatch(lead.id, {
                            stage: value ? "messaged" : "found",
                            inOutreach: Boolean(value),
                          }).catch(() => undefined);
                        }}
                      />
                    </TableCell>
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <Checkbox
                        checked={isReplied(lead)}
                        onCheckedChange={(value) => {
                          handlePatch(lead.id, {
                            stage: value ? "replied" : isDMed(lead) ? "messaged" : "found",
                            inOutreach: Boolean(value) || isDMed(lead),
                          }).catch(() => undefined);
                        }}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{lead.email ?? "—"}</TableCell>
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <button
                        type="button"
                        className="inline-flex size-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        onClick={() => {
                          setSelectedLead(lead);
                          setSheetOpen(true);
                        }}
                      >
                        <MoreHorizontalIcon className="size-5" />
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <div className="mt-6 flex flex-col gap-5 text-muted-foreground xl:flex-row xl:items-end xl:justify-between">
          <div className="text-[1rem]">
            <div>{total}</div>
            <div>leads</div>
          </div>

          <Pagination className="mx-0 w-auto justify-start xl:justify-end">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  className={page === 1 ? "pointer-events-none opacity-50" : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    setPage((current) => Math.max(1, current - 1));
                  }}
                />
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#" isActive onClick={(event) => event.preventDefault()}>
                  {page}
                </PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationNext
                  href="#"
                  className={page === totalPages ? "pointer-events-none opacity-50" : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    setPage((current) => Math.min(totalPages, current + 1));
                  }}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      </div>

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
