"use client";

import { ActivityIcon, SearchIcon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { XLogoIcon } from "@/components/ui/x-icon";
import { cn } from "@/lib/utils";
import type { MonitoredLead } from "@/lib/validations/monitoring";

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

function statusColor(status: string) {
  switch (status) {
    case "reached_out":
      return "bg-yellow-100 text-yellow-700";
    case "answered":
      return "bg-blue-100 text-blue-700";
    case "done":
      return "bg-green-100 text-green-700";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function statusLabel(status: string) {
  switch (status) {
    case "reached_out":
      return "reached out";
    case "answered":
      return "answered";
    case "done":
      return "done";
    default:
      return status;
  }
}

function timeAgo(dateStr?: string): string {
  if (!dateStr) return "never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface MonitoringTableProps {
  leads: MonitoredLead[];
  isLoading: boolean;
  selectedIds: string[];
  allFilteredSelected: boolean;
  allVisibleSelected: boolean;
  onToggleAllSelection: (checked: boolean) => void;
  onToggleRowSelection: (leadId: string, checked: boolean) => void;
  onOpenLead: (lead: MonitoredLead) => void;
  onPatch: (id: string, patch: Partial<MonitoredLead>) => void;
}

export function MonitoringTable({
  leads,
  isLoading,
  selectedIds,
  allFilteredSelected,
  allVisibleSelected,
  onToggleAllSelection,
  onToggleRowSelection,
  onOpenLead,
  onPatch,
}: MonitoringTableProps) {
  return (
    <div className="overflow-hidden rounded-md border border-border/70 bg-background shadow-[0_1px_0_rgba(0,0,0,0.02)]">
      {isLoading ? (
        <div className="flex h-[320px] items-center justify-center text-muted-foreground">
          <Spinner className="size-4" />
          <span className="ml-2">Loading monitored leads...</span>
        </div>
      ) : leads.length === 0 ? (
        <Empty className="min-h-[320px]">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ActivityIcon />
            </EmptyMedia>
            <EmptyTitle>No monitored leads</EmptyTitle>
            <EmptyDescription>
              Export leads from Leads or Contra and enable monitoring to track DM conversations.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table className="text-[0.9rem]">
          <TableHeader className="bg-muted/10 [&_tr]:border-b [&_tr]:border-border/55">
            <TableRow className="h-10 hover:bg-transparent">
              <TableHead className="w-[52px] border-r border-border/45 !px-3">
                <div className="flex items-center justify-center">
                  <Checkbox checked={allVisibleSelected} onCheckedChange={(value) => onToggleAllSelection(Boolean(value))} />
                </div>
              </TableHead>
              <TableHead className="min-w-[200px] border-r border-border/45">Name</TableHead>
              <TableHead className="w-[68px] border-r border-border/45 text-center">Platform</TableHead>
              <TableHead className="w-[120px] border-r border-border/45 text-center">Handle</TableHead>
              <TableHead className="w-[86px] border-r border-border/45 text-center">Followers</TableHead>
              <TableHead className="w-[110px] border-r border-border/45 text-center">Status</TableHead>
              <TableHead className="w-[70px] border-r border-border/45 text-center">Monitor</TableHead>
              <TableHead className="w-[90px] border-r border-border/45 text-center">Last Check</TableHead>
              <TableHead className="w-[80px] border-r border-border/45 text-center">Source</TableHead>
              <TableHead className="w-[80px] text-center">DM</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.map((lead) => (
              <TableRow
                key={lead.id}
                className="h-[52px] border-b border-border/45 hover:bg-muted/5 cursor-pointer"
                onClick={() => onOpenLead(lead)}
              >
                <TableCell className="border-r border-border/45 !px-3" onClick={(event) => event.stopPropagation()}>
                  <div className="flex items-center justify-center">
                    <Checkbox
                      checked={allFilteredSelected || selectedIds.includes(lead.id)}
                      onCheckedChange={(value) => onToggleRowSelection(lead.id, Boolean(value))}
                    />
                  </div>
                </TableCell>
                <TableCell className="border-r border-border/45">
                  <div className="flex items-center gap-2.5">
                    <Avatar className="size-8">
                      {lead.avatarUrl ? <AvatarImage src={lead.avatarUrl} alt={lead.name} /> : null}
                      <AvatarFallback>{initials(lead.name)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="truncate text-[0.94rem] font-semibold">{lead.name}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="border-r border-border/45 text-center">
                  <XLogoIcon className="inline size-3.5" />
                </TableCell>
                <TableCell className="border-r border-border/45 text-center text-[0.86rem] text-muted-foreground">
                  @{lead.handle}
                </TableCell>
                <TableCell className="border-r border-border/45 text-center text-[0.92rem] font-semibold">
                  {formatFollowers(lead.followers)}
                </TableCell>
                <TableCell className="border-r border-border/45 text-center" onClick={(event) => event.stopPropagation()}>
                  <Badge
                    variant="outline"
                    className={cn(
                      "h-6 cursor-pointer rounded-sm border-transparent px-1.5 text-[0.76rem] font-semibold",
                      statusColor(lead.responseStatus),
                    )}
                    onClick={() => {
                      const next =
                        lead.responseStatus === "reached_out"
                          ? "answered"
                          : lead.responseStatus === "answered"
                            ? "done"
                            : "reached_out";
                      onPatch(lead.id, { responseStatus: next });
                    }}
                  >
                    {statusLabel(lead.responseStatus)}
                  </Badge>
                </TableCell>
                <TableCell className="border-r border-border/45 !px-3" onClick={(event) => event.stopPropagation()}>
                  <div className="flex items-center justify-center">
                    <Checkbox
                      checked={lead.monitoring}
                      onCheckedChange={(value) => onPatch(lead.id, { monitoring: Boolean(value) })}
                    />
                  </div>
                </TableCell>
                <TableCell className="border-r border-border/45 text-center text-[0.82rem] text-muted-foreground">
                  {timeAgo(lead.lastDmCheck)}
                </TableCell>
                <TableCell className="border-r border-border/45 text-center">
                  <Badge
                    variant="outline"
                    className={cn(
                      "h-6 rounded-sm border-transparent px-1.5 text-[0.72rem]",
                      lead.sourceTable === "contra" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700",
                    )}
                  >
                    {lead.sourceTable}
                  </Badge>
                </TableCell>
                <TableCell className="text-center">
                  <Button
                    variant="outline"
                    className="h-7 rounded-lg px-2.5 text-[0.78rem]"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenLead(lead);
                    }}
                  >
                    View DM
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
