"use client";

import { MoreHorizontalIcon, SearchIcon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { XLogoIcon } from "@/components/ui/x-icon";
import { cn } from "@/lib/utils";
import type { ContraLead } from "@/lib/validations/contra";

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

function isDMed(lead: ContraLead): boolean {
  return lead.stage === "messaged" || lead.stage === "replied" || lead.stage === "agreed";
}

function isReplied(lead: ContraLead): boolean {
  return lead.stage === "replied" || lead.stage === "agreed";
}

interface ContraTableProps {
  leads: ContraLead[];
  isLoading: boolean;
  selectedIds: string[];
  allFilteredSelected: boolean;
  allVisibleSelected: boolean;
  onToggleAllSelection: (checked: boolean) => void;
  onToggleRowSelection: (leadId: string, checked: boolean) => void;
  onOpenLead: (lead: ContraLead) => void;
  onPatch: (id: string, patch: Partial<ContraLead>) => Promise<void>;
}

export function ContraTable({
  leads,
  isLoading,
  selectedIds,
  allFilteredSelected,
  allVisibleSelected,
  onToggleAllSelection,
  onToggleRowSelection,
  onOpenLead,
  onPatch,
}: ContraTableProps) {
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
              Adjust your filters or seed the contra table.
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
              <TableHead className="min-w-[220px] border-r border-border/45">Bio</TableHead>
              <TableHead className="w-[86px] border-r border-border/45 text-center">Followers</TableHead>
              <TableHead className="w-[70px] border-r border-border/45 text-center">Relevancy</TableHead>
              <TableHead className="w-[70px] border-r border-border/45 text-center">Price</TableHead>
              <TableHead className="w-[64px] border-r border-border/45 text-center">DM</TableHead>
              <TableHead className="w-[72px] border-r border-border/45 text-center">Reply</TableHead>
              <TableHead className="w-[80px] border-r border-border/45 text-center">Source</TableHead>
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
                      <div className="truncate text-[0.82rem] text-muted-foreground">@{lead.handle}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="border-r border-border/45 text-center">
                  <XLogoIcon className="inline size-3.5" />
                </TableCell>
                <TableCell className="max-w-[220px] border-r border-border/45">
                  <div className="truncate text-[0.86rem] text-muted-foreground">{lead.bio || "—"}</div>
                </TableCell>
                <TableCell className="border-r border-border/45 text-center text-[0.92rem] font-semibold">{formatFollowers(lead.followers)}</TableCell>
                <TableCell className="border-r border-border/45 text-center">
                  <Badge
                    variant="outline"
                    className={cn(
                      "h-6 rounded-sm border-transparent px-1.5 text-[0.76rem] font-semibold",
                      lead.relevancy === "high" ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {lead.relevancy ?? "—"}
                  </Badge>
                </TableCell>
                <TableCell className="border-r border-border/45 text-center text-[0.86rem] text-muted-foreground">
                  {lead.price != null ? `$${lead.price}` : "—"}
                </TableCell>
                <TableCell className="border-r border-border/45 !px-3" onClick={(event) => event.stopPropagation()}>
                  <div className="flex items-center justify-center">
                    <Checkbox
                      checked={isDMed(lead)}
                      onCheckedChange={(value) => {
                        onPatch(lead.id, {
                          stage: value ? "messaged" : "found",
                          inOutreach: Boolean(value),
                        }).catch(() => undefined);
                      }}
                    />
                  </div>
                </TableCell>
                <TableCell className="border-r border-border/45 !px-3" onClick={(event) => event.stopPropagation()}>
                  <div className="flex items-center justify-center">
                    <Checkbox
                      checked={isReplied(lead)}
                      onCheckedChange={(value) => {
                        onPatch(lead.id, {
                          stage: value ? "replied" : isDMed(lead) ? "messaged" : "found",
                          inOutreach: Boolean(value) || isDMed(lead),
                        }).catch(() => undefined);
                      }}
                    />
                  </div>
                </TableCell>
                <TableCell className="border-r border-border/45 text-center">
                  <Badge
                    variant="outline"
                    className={cn(
                      "h-6 rounded-sm border-transparent px-1.5 text-[0.72rem]",
                      lead.source === "influencer" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700",
                    )}
                  >
                    {lead.source ?? "—"}
                  </Badge>
                </TableCell>
                <TableCell className="text-center" onClick={(event) => event.stopPropagation()}>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => onOpenLead(lead)}
                  >
                    <MoreHorizontalIcon className="size-5" />
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
