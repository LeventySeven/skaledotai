"use client";

import { useState } from "react";
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
import { MonitoringTable } from "@/components/monitoring/MonitoringTable";
import { DMChatSheet } from "@/components/monitoring/DMChatSheet";
import { DmSuggestPanel } from "@/components/monitoring/DmSuggestPanel";
import { useMonitoringWorkspace } from "@/components/monitoring/useMonitoringWorkspace";
import { RefreshCwIcon, MailCheckIcon, UsersIcon } from "lucide-react";

export function MonitoringWorkspace() {
  const workspace = useMonitoringWorkspace();
  const [suggestOpen, setSuggestOpen] = useState(false);

  return (
    <div className="px-8 py-8">
      <div className="mx-auto max-w-[1820px]">
        <div className="flex w-full items-start justify-between pb-6">
          <div className="flex flex-col">
            <div className="text-[18px] font-medium text-[#111111]/40">Monitoring</div>
            <h1 className="text-[28px] font-medium tracking-[-0.04em]">DM Monitoring</h1>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="h-8 rounded-[10px] px-3.5 text-[0.88rem]"
              onClick={() => setSuggestOpen(true)}
            >
              <UsersIcon className="size-4" />
              Suggest from DMs
            </Button>
            <Button
              variant="outline"
              className="h-8 rounded-[10px] px-3.5 text-[0.88rem]"
              disabled={workspace.isCheckingAll}
              onClick={workspace.handleCheckAll}
            >
              {workspace.isCheckingAll ? <Spinner className="size-4" /> : <RefreshCwIcon className="size-4" />}
              Check All DMs
            </Button>
            <Button
              variant="outline"
              className="h-8 rounded-[10px] px-3.5 text-[0.88rem]"
              onClick={() => {
                if (workspace.leads.length > 0) {
                  workspace.openLead(workspace.leads[0]);
                }
              }}
              disabled={workspace.leads.length === 0}
            >
              <MailCheckIcon className="size-4" />
              View All DMs
            </Button>
          </div>
        </div>
        <div className="-mx-8 mb-5 border-b border-border/70" />

        <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Select value={workspace.status} onValueChange={(val) => workspace.updateStatusFilter(val as "all" | "reached_out" | "answered" | "done")}>
              <SelectTrigger className="h-8 min-w-[150px] rounded-[10px] text-[0.88rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="all">all statuses</SelectItem>
                <SelectItem value="reached_out">reached out</SelectItem>
                <SelectItem value="answered">answered</SelectItem>
                <SelectItem value="done">done</SelectItem>
              </SelectPopup>
            </Select>

            <Select value={workspace.sort} onValueChange={(val) => workspace.updateSort(val as typeof workspace.sort)}>
              <SelectTrigger className="h-8 min-w-[180px] rounded-[10px] text-[0.88rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="recent">recently updated</SelectItem>
                <SelectItem value="followers-desc">followers-desc</SelectItem>
                <SelectItem value="followers-asc">followers-asc</SelectItem>
                <SelectItem value="name-asc">name-asc</SelectItem>
              </SelectPopup>
            </Select>
          </div>

          <Input
            className="h-8 w-full max-w-[230px] rounded-[10px] text-[0.88rem]"
            placeholder="Search monitored..."
            value={workspace.search}
            onChange={(event) => workspace.updateSearch(event.target.value)}
          />
        </div>

        <MonitoringTable
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
            <div>monitored leads</div>
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

      <DMChatSheet
        lead={workspace.selectedLead}
        open={workspace.sheetOpen}
        onOpenChange={workspace.setSheetOpen}
        onPatch={workspace.handlePatch}
        onRemove={workspace.handleRemove}
      />

      <DmSuggestPanel
        open={suggestOpen}
        onOpenChange={setSuggestOpen}
        onAdded={() => {
          workspace.setPage(1);
        }}
      />

      {workspace.selectedCount > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center pb-6">
          <div className="flex items-center gap-3 rounded-[14px] border border-border/70 bg-background px-4 py-2.5 shadow-lg">
            <span className="text-[0.88rem] font-medium">
              {workspace.selectedCount} selected
            </span>
            <div className="h-4 w-px bg-border" />
            <Button
              variant="outline"
              className="h-8 rounded-[10px] px-3.5 text-[0.88rem]"
              onClick={() => workspace.handleBulkStatus("reached_out")}
            >
              Reached Out
            </Button>
            <Button
              variant="outline"
              className="h-8 rounded-[10px] px-3.5 text-[0.88rem]"
              onClick={() => workspace.handleBulkStatus("answered")}
            >
              Answered
            </Button>
            <Button
              variant="outline"
              className="h-8 rounded-[10px] px-3.5 text-[0.88rem]"
              onClick={() => workspace.handleBulkStatus("done")}
            >
              Done
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
