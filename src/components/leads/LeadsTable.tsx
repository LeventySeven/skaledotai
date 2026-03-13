"use client";

import { MoreHorizontalIcon, SearchIcon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { Lead } from "@/lib/validations/leads";

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

function isDMed(lead: Lead): boolean {
  return lead.stage === "messaged" || lead.stage === "replied" || lead.stage === "agreed";
}

function isReplied(lead: Lead): boolean {
  return lead.stage === "replied" || lead.stage === "agreed";
}

interface LeadsTableProps {
  leads: Lead[];
  isLoading: boolean;
  selectedIds: string[];
  allFilteredSelected: boolean;
  allVisibleSelected: boolean;
  onToggleAllSelection: (checked: boolean) => void;
  onToggleRowSelection: (leadId: string, checked: boolean) => void;
  onOpenLead: (lead: Lead) => void;
  onPatch: (id: string, patch: Partial<Lead>) => Promise<void>;
}

export function LeadsTable({
  leads,
  isLoading,
  selectedIds,
  allFilteredSelected,
  allVisibleSelected,
  onToggleAllSelection,
  onToggleRowSelection,
  onOpenLead,
  onPatch,
}: LeadsTableProps) {
  return (
    <div className="overflow-hidden rounded-md border border-border/70 bg-background shadow-[0_1px_0_rgba(0,0,0,0.02)]">
      {isLoading ? (
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
                <Checkbox id="select-all" checked={allVisibleSelected} onCheckedChange={(value) => onToggleAllSelection(Boolean(value))} />
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
              <TableRow
                key={lead.id}
                className="h-[52px] border-b border-border/45 hover:bg-muted/5"
                onClick={() => onOpenLead(lead)}
              >
                <TableCell className="border-r border-border/45 px-2 text-center" onClick={(event) => event.stopPropagation()}>
                  <Checkbox
                    id={`select-${lead.id}`}
                    checked={allFilteredSelected || selectedIds.includes(lead.id)}
                    onCheckedChange={(value) => onToggleRowSelection(lead.id, Boolean(value))}
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
                    id={`dm-${lead.id}`}
                    checked={isDMed(lead)}
                    onCheckedChange={(value) => {
                      onPatch(lead.id, {
                        stage: value ? "messaged" : "found",
                        inOutreach: Boolean(value),
                      }).catch(() => undefined);
                    }}
                  />
                </TableCell>
                <TableCell className="border-r border-border/45 text-center" onClick={(event) => event.stopPropagation()}>
                  <Checkbox
                    id={`reply-${lead.id}`}
                    checked={isReplied(lead)}
                    onCheckedChange={(value) => {
                      onPatch(lead.id, {
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
                    onClick={() => onOpenLead(lead)}
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
  );
}
