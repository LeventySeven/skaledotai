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
import type { Lead } from "@/lib/validations/leads";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants";

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
  const [allFilteredSelected, setAllFilteredSelected] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    setProjectId(projectParam);
    setPage(1);
    setSelectedIds([]);
    setAllFilteredSelected(false);
  }, [projectParam]);

  const listQuery = trpc.leads.list.useQuery({
    page,
    pageSize: DEFAULT_PAGE_SIZE,
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
  const totalPages = Math.max(1, Math.ceil(total / DEFAULT_PAGE_SIZE));
  const currentProject = useMemo(
    () => projects.find((project) => project.id === projectId),
    [projectId, projects],
  );

  const allVisibleSelected = allFilteredSelected || (leads.length > 0 && leads.every((lead) => selectedIds.includes(lead.id)));
  const selectedCount = allFilteredSelected ? total : selectedIds.length;

  async function handlePatch(id: string, patch: Partial<Lead>) {
    await updateLead.mutateAsync({
      crmId: id,
      patch: toPatchInput(patch),
    });
  }

  function toggleRowSelection(leadId: string, checked: boolean) {
    setAllFilteredSelected(false);
    setSelectedIds((current) =>
      checked ? [...new Set([...current, leadId])] : current.filter((id) => id !== leadId),
    );
  }

  function toggleAllSelection(checked: boolean) {
    setAllFilteredSelected(false);
    setSelectedIds(checked ? leads.map((lead) => lead.id) : []);
  }

  function selectEntireSheet() {
    setAllFilteredSelected(true);
    setSelectedIds([]);
  }

  function clearSelection() {
    setAllFilteredSelected(false);
    setSelectedIds([]);
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
    <div className="px-4 py-4">
      <div className="mx-auto max-w-[1820px]">
        <div className="mb-4 flex items-start justify-between gap-6">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-[2.55rem] font-semibold tracking-[-0.04em]">
                {currentProject?.name ?? "Leads"}
              </h1>
              {selectedCount > 0 ? (
                <Badge variant="outline" className="h-8 rounded-full px-3 text-sm font-semibold">
                  {selectedCount} selected
                </Badge>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {total > 0 ? (
              <>
                <Button
                  variant="outline"
                  className="h-9 rounded-xl px-3.5 text-[0.92rem]"
                  onClick={selectEntireSheet}
                >
                  Select entire sheet
                </Button>
                {selectedCount > 0 ? (
                  <Button
                    variant="outline"
                    className="h-9 rounded-xl px-3.5 text-[0.92rem]"
                    onClick={clearSelection}
                  >
                    Clear selection
                  </Button>
                ) : null}
              </>
            ) : null}
            <Button
              variant="outline"
              className="h-9 rounded-xl px-3.5 text-[0.92rem]"
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
              className="h-9 rounded-xl px-3.5 text-[0.92rem]"
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

        <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row">
            <select
              className="h-9 min-w-[200px] rounded-xl border border-input bg-background px-3 text-[0.9rem] shadow-xs/5"
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
              className="h-9 min-w-[150px] rounded-xl border border-input bg-background px-3 text-[0.9rem] shadow-xs/5"
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
              className="h-9 min-w-[180px] rounded-xl border border-input bg-background px-3 text-[0.9rem] shadow-xs/5"
              value={sort}
              onChange={(event) => setSort(event.target.value as typeof sort)}
            >
              <option value="followers-desc">followers-desc</option>
              <option value="followers-asc">followers-asc</option>
              <option value="name-asc">name-asc</option>
            </select>
          </div>

          <Input
            className="h-9 w-full max-w-[230px] rounded-xl text-[0.9rem]"
            placeholder="Search leads..."
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </div>

        <div className="overflow-hidden rounded-md border border-border/70 bg-background shadow-[0_1px_0_rgba(0,0,0,0.02)]">
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
            <Table className="text-[0.9rem]">
              <TableHeader className="bg-muted/10 [&_tr]:border-b [&_tr]:border-border/55">
                <TableRow className="h-10 hover:bg-transparent">
                  <TableHead className="w-[40px] border-r border-border/45 px-2 text-center">
                    <Checkbox checked={allVisibleSelected} onCheckedChange={(value) => toggleAllSelection(Boolean(value))} />
                  </TableHead>
                  <TableHead className="min-w-[230px] border-r border-border/45">Name</TableHead>
                  <TableHead className="w-[68px] border-r border-border/45 text-center">X</TableHead>
                  <TableHead className="min-w-[250px] border-r border-border/45">Bio</TableHead>
                  <TableHead className="w-[86px] border-r border-border/45 text-center">Followers</TableHead>
                  <TableHead className="w-[70px] border-r border-border/45 text-center">P</TableHead>
                  <TableHead className="w-[64px] border-r border-border/45 text-center">DM</TableHead>
                  <TableHead className="w-[72px] border-r border-border/45 text-center">Reply</TableHead>
                  <TableHead className="w-[96px] border-r border-border/45 text-center">Email</TableHead>
                  <TableHead className="w-[40px] text-center" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((lead) => (
                  <TableRow key={lead.id} className="h-[52px] border-b border-border/45 hover:bg-muted/5" onClick={() => {
                    setSelectedLead(lead);
                    setSheetOpen(true);
                  }}>
                    <TableCell className="border-r border-border/45 px-2 text-center" onClick={(event) => event.stopPropagation()}>
                      <Checkbox
                        checked={allFilteredSelected || selectedIds.includes(lead.id)}
                        onCheckedChange={(value) => toggleRowSelection(lead.id, Boolean(value))}
                      />
                    </TableCell>
                    <TableCell className="border-r border-border/45">
                      <div className="flex items-center gap-2.5">
                        <Avatar className="size-8">
                          {lead.avatarUrl ? <AvatarImage src={lead.avatarUrl} alt={lead.name} /> : null}
                          <AvatarFallback>{initials(lead.name)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="truncate text-[0.94rem] font-semibold">{lead.name}</div>
                          <div className="truncate text-[0.82rem] text-muted-foreground">@{lead.handle}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="border-r border-border/45 text-center">
                      <Badge variant="outline" className="h-6 rounded-sm border-border/50 bg-background px-1.5 text-[0.76rem] font-medium lowercase">
                        x
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[250px] border-r border-border/45">
                      <div className="truncate text-[0.86rem] text-muted-foreground">{lead.bio || "—"}</div>
                    </TableCell>
                    <TableCell className="border-r border-border/45 text-center text-[0.92rem] font-semibold">{formatFollowers(lead.followers)}</TableCell>
                    <TableCell className="border-r border-border/45 text-center">
                      <Badge
                        variant="outline"
                        className={cn(
                          "h-6 rounded-sm border-transparent px-1.5 text-[0.76rem] font-semibold",
                          lead.priority === "P0" ? "bg-orange-100 text-orange-700" : "bg-muted text-muted-foreground",
                        )}
                      >
                        {lead.priority}
                      </Badge>
                    </TableCell>
                    <TableCell className="border-r border-border/45 text-center" onClick={(event) => event.stopPropagation()}>
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
                    <TableCell className="border-r border-border/45 text-center" onClick={(event) => event.stopPropagation()}>
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
                    <TableCell className="border-r border-border/45 text-center text-[0.82rem] text-muted-foreground">{lead.email ?? "—"}</TableCell>
                    <TableCell className="text-center" onClick={(event) => event.stopPropagation()}>
                      <button
                        type="button"
                        className="inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
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

        <div className="mt-4 flex flex-col gap-4 text-muted-foreground xl:flex-row xl:items-end xl:justify-between">
          <div className="text-[0.92rem]">
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
