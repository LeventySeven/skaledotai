"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { LeadDetailSheet } from "@/components/leads/LeadDetailSheet";
import { LeadsTable } from "@/components/leads/LeadsTable";
import { toastManager } from "@/components/ui/toast";
import { useLeadsWorkspace } from "@/components/leads/useLeadsWorkspace";
import { trpc } from "@/lib/trpc/client";
import { ActivityIcon } from "lucide-react";

export function LeadsWorkspace() {
  const workspace = useLeadsWorkspace();
  const addToMonitoring = trpc.monitoring.add.useMutation({
    onSuccess: (count) => {
      toastManager.add({ type: "success", title: `Added ${count} leads to monitoring.` });
      workspace.clearSelection();
    },
    onError: (error) => {
      toastManager.add({ type: "error", title: error.message });
    },
  });

  return (
    <div className="px-8 py-8">
      <div className="mx-auto max-w-[1820px]">
        <div className="flex w-full items-start justify-between pb-6">
          <div className="flex flex-col">
            <div className="text-[18px] font-medium text-[#111111]/40">Database</div>
            <h1 className="text-[28px] font-medium tracking-[-0.04em]">
              {workspace.currentProject?.name ?? "Database"}
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              className="h-8 rounded-[10px] px-3.5 text-[0.88rem]"
              disabled={workspace.isRefreshingStats || workspace.leads.length === 0}
              onClick={() => {
                workspace.handleScanBios().catch((error: unknown) => {
                  toastManager.add({ type: "error", title: error instanceof Error ? error.message : "Scan failed." });
                });
              }}
            >
              {workspace.isRefreshingStats ? <Spinner className="size-4" /> : null}
              {workspace.isRefreshingStats ? "Scanning..." : "Scan Bios"}
            </Button>

            <Button
              variant="outline"
              className="h-8 rounded-[10px] px-3.5 text-[0.88rem]"
              disabled={workspace.isEnrichingEmails}
              onClick={() => {
                workspace.handleEnrichEmails().catch((error: unknown) => {
                  toastManager.add({ type: "error", title: error instanceof Error ? error.message : "Enrichment failed." });
                });
              }}
            >
              {workspace.isEnrichingEmails ? <Spinner className="size-4" /> : null}
              Enrich Emails
            </Button>
          </div>
        </div>
        <div className="-mx-8 mb-5 border-b border-border/70" />

        <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Select
              value={workspace.projectId}
              onValueChange={(val) => workspace.updateProjectFilter(val as string)}
            >
              <SelectTrigger className="h-8 min-w-[200px] rounded-[10px] text-[0.88rem]">
                <span className="flex-1 truncate">
                  {workspace.currentProject?.name ?? "All Projects"}
                </span>
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="">All Projects</SelectItem>
                {workspace.projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>

            <Select value={workspace.stage} onValueChange={(val) => workspace.updateStageFilter(val as typeof workspace.stage)}>
              <SelectTrigger className="h-8 min-w-[150px] rounded-[10px] text-[0.88rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="all">all</SelectItem>
                <SelectItem value="found">found</SelectItem>
                <SelectItem value="messaged">messaged</SelectItem>
                <SelectItem value="replied">replied</SelectItem>
                <SelectItem value="agreed">agreed</SelectItem>
              </SelectPopup>
            </Select>

            <Select value={workspace.sort} onValueChange={(val) => workspace.updateSort(val as typeof workspace.sort)}>
              <SelectTrigger className="h-8 min-w-[180px] rounded-[10px] text-[0.88rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="followers-desc">followers-desc</SelectItem>
                <SelectItem value="followers-asc">followers-asc</SelectItem>
                <SelectItem value="name-asc">name-asc</SelectItem>
              </SelectPopup>
            </Select>
          </div>

          <Input
            className="h-8 w-full max-w-[230px] rounded-[10px] text-[0.88rem]"
            placeholder="Search leads..."
            value={workspace.search}
            onChange={(event) => workspace.updateSearch(event.target.value)}
          />
        </div>

        <LeadsTable
          leads={workspace.leads}
          isLoading={workspace.isLoading}
          selectedIds={workspace.selectedIds}
          allFilteredSelected={workspace.allFilteredSelected}
          allVisibleSelected={workspace.allVisibleSelected}
          onToggleAllSelection={workspace.toggleAllSelection}
          onToggleRowSelection={workspace.toggleRowSelection}
          onOpenLead={workspace.openLead}
          onPatch={workspace.handlePatch}
        />

        <div className="mt-4 flex flex-col gap-4 text-muted-foreground xl:flex-row xl:items-end xl:justify-between">
          <div className="text-[0.92rem]">
            <div>{workspace.total}</div>
            <div>leads</div>
          </div>

          <Pagination className="mx-0 w-auto justify-start xl:justify-end">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  className={workspace.page === 1 ? "pointer-events-none opacity-50" : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    workspace.setPage(Math.max(1, workspace.page - 1));
                  }}
                />
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#" isActive onClick={(event) => event.preventDefault()}>
                  {workspace.page}
                </PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationNext
                  href="#"
                  className={workspace.page === workspace.totalPages ? "pointer-events-none opacity-50" : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    workspace.setPage(Math.min(workspace.totalPages, workspace.page + 1));
                  }}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      </div>

      <LeadDetailSheet
        lead={workspace.selectedLead}
        open={workspace.sheetOpen}
        onOpenChange={workspace.setSheetOpen}
        onPatch={workspace.handlePatch}
        niche={workspace.currentProject?.query}
        projectId={workspace.currentProject?.id}
        enableReasoning={workspace.currentProject?.sourceProviders.includes("multiagent")}
      />

      {workspace.selectedCount > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center pb-6 pl-[var(--sidebar-width,280px)]">
          <div className="flex items-center gap-3 rounded-[14px] border border-border/70 bg-background px-4 py-2.5 shadow-lg">
            <span className="text-[0.88rem] font-medium">
              {workspace.selectedCount} selected
            </span>
            <div className="h-4 w-px bg-border" />
            <Button
              variant="outline"
              className="h-8 rounded-[10px] px-3.5 text-[0.88rem]"
              disabled={addToMonitoring.isPending}
              onClick={() => {
                addToMonitoring.mutate({
                  sourceTable: "leads",
                  sourceIds: workspace.selectedIds,
                });
              }}
            >
              <ActivityIcon className="size-4" />
              {addToMonitoring.isPending ? "Adding..." : "Add to Monitoring"}
            </Button>
            <div className="h-4 w-px bg-border" />
            <Button
              variant="outline"
              className="h-8 rounded-[10px] px-3.5 text-[0.88rem]"
              onClick={workspace.selectEntireSheet}
            >
              Select all
            </Button>
            <Button
              variant="ghost"
              className="h-8 rounded-[10px] px-3.5 text-[0.88rem]"
              onClick={workspace.clearSelection}
            >
              Clear
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
