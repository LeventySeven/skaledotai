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
import { ContraDetailSheet } from "@/components/contra/ContraDetailSheet";
import { ContraTable } from "@/components/contra/ContraTable";
import { toastManager } from "@/components/ui/toast";
import { useContraWorkspace } from "@/components/contra/useContraWorkspace";
import { trpc } from "@/lib/trpc/client";
import { DownloadIcon } from "lucide-react";
import { useState } from "react";

function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function ContraWorkspace() {
  const workspace = useContraWorkspace();
  const exportQuery = trpc.contra.exportForDocs.useQuery(undefined, { enabled: false });
  const [isExporting, setIsExporting] = useState(false);

  async function handleExportToGoogleDocs() {
    setIsExporting(true);
    try {
      const { data: leads } = await exportQuery.refetch();
      if (!leads || leads.length === 0) {
        toastManager.add({ type: "info", title: "No leads to export." });
        return;
      }

      const headers = [
        "Handle", "Name", "Bio", "Followers", "Platform", "Relevancy",
        "Price", "Email", "Website", "LinkedIn", "Profile URL",
        "Tags", "Source", "Reached Out", "Stage", "Notes",
      ];

      const rows = leads.map((lead) => [
        lead.handle,
        lead.name,
        lead.bio,
        String(lead.followers),
        lead.platform,
        lead.relevancy ?? "",
        lead.price != null ? String(lead.price) : "",
        lead.email ?? "",
        lead.site ?? "",
        lead.linkedinUrl ?? "",
        lead.url ?? "",
        lead.tags.join("; "),
        lead.source ?? "",
        lead.reachedOut ? "Yes" : "No",
        lead.stage,
        lead.notes ?? "",
      ]);

      const csv = [
        headers.map(escapeCSV).join(","),
        ...rows.map((row) => row.map(escapeCSV).join(",")),
      ].join("\n");

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `contra-leads-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);

      toastManager.add({
        type: "success",
        title: `Exported ${leads.length} leads. Import the CSV into Google Sheets.`,
      });
    } catch (err) {
      toastManager.add({ type: "error", title: err instanceof Error ? err.message : "Export failed." });
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="px-8 py-8">
      <div className="mx-auto max-w-[1820px]">
        <div className="flex w-full items-start justify-between pb-6">
          <div className="flex flex-col">
            <div className="text-[18px] font-medium text-[#111111]/40">Campaign</div>
            <h1 className="text-[28px] font-medium tracking-[-0.04em]">Contra</h1>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              className="h-8 rounded-[10px] px-3.5 text-[0.88rem]"
              disabled={isExporting}
              onClick={() => {
                handleExportToGoogleDocs().catch(() => undefined);
              }}
            >
              {isExporting ? <Spinner className="size-4" /> : <DownloadIcon className="size-4" />}
              Export to Google Docs
            </Button>
          </div>
        </div>
        <div className="-mx-8 mb-5 border-b border-border/70" />

        <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Select value={workspace.relevancy} onValueChange={(val) => workspace.updateRelevancy(val as "all" | "high" | "low")}>
              <SelectTrigger className="h-8 min-w-[140px] rounded-[10px] text-[0.88rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="all">all relevancy</SelectItem>
                <SelectItem value="high">high</SelectItem>
                <SelectItem value="low">low</SelectItem>
              </SelectPopup>
            </Select>

            <Select value={workspace.source} onValueChange={(val) => workspace.updateSource(val as "all" | "internal" | "influencer")}>
              <SelectTrigger className="h-8 min-w-[140px] rounded-[10px] text-[0.88rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="all">all sources</SelectItem>
                <SelectItem value="internal">internal</SelectItem>
                <SelectItem value="influencer">influencer</SelectItem>
              </SelectPopup>
            </Select>

            <Select value={workspace.stage} onValueChange={(val) => workspace.updateStageFilter(val as typeof workspace.stage)}>
              <SelectTrigger className="h-8 min-w-[150px] rounded-[10px] text-[0.88rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="all">all stages</SelectItem>
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
                <SelectItem value="price-desc">price-desc</SelectItem>
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

        <ContraTable
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

      <ContraDetailSheet
        lead={workspace.selectedLead}
        open={workspace.sheetOpen}
        onOpenChange={workspace.setSheetOpen}
        onPatch={workspace.handlePatch}
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
