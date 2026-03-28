"use client";

import {
  Sheet, SheetPopup, SheetHeader, SheetTitle, SheetDescription,
  SheetPanel,
} from "@/components/ui/sheet";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { RefreshCwIcon, TrashIcon, ExternalLinkIcon } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import type { MonitoredLead } from "@/lib/validations/monitoring";

interface DMChatSheetProps {
  lead: MonitoredLead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPatch: (id: string, patch: Partial<MonitoredLead>) => void;
  onRemove: (id: string) => void;
}

function initials(name: string): string {
  return name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

function statusColor(status: string) {
  switch (status) {
    case "reached_out": return "bg-yellow-100 text-yellow-700";
    case "answered": return "bg-blue-100 text-blue-700";
    case "done": return "bg-green-100 text-green-700";
    default: return "bg-muted text-muted-foreground";
  }
}

function formatTime(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function DMChatContent({
  lead,
  onPatch,
  onRemove,
}: {
  lead: MonitoredLead;
  onPatch: (id: string, patch: Partial<MonitoredLead>) => void;
  onRemove: (id: string) => void;
}) {
  const dmQuery = trpc.monitoring.getDms.useQuery(
    { monitoredLeadId: lead.id },
    { enabled: !!lead.id },
  );
  const refreshMutation = trpc.monitoring.refreshDms.useMutation({
    onSuccess: () => {
      dmQuery.refetch();
    },
  });

  const conversation = dmQuery.data;
  const events = conversation?.events ?? [];

  return (
    <>
      <SheetHeader>
        <div className="flex items-start gap-4 pr-8">
          <Avatar className="size-14 shrink-0">
            {lead.avatarUrl && <AvatarImage src={lead.avatarUrl} alt={lead.name} />}
            <AvatarFallback>{initials(lead.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <SheetTitle>{lead.name}</SheetTitle>
            <SheetDescription className="mt-0.5">@{lead.handle}</SheetDescription>
            <div className="mt-2 flex items-center gap-1.5">
              <Badge variant="secondary" className="text-xs">
                {formatNumber(lead.followers)} followers
              </Badge>
              <Badge
                variant="outline"
                className={cn("text-xs border-transparent", statusColor(lead.responseStatus))}
              >
                {lead.responseStatus.replace("_", " ")}
              </Badge>
            </div>
          </div>
        </div>
      </SheetHeader>

      <SheetPanel>
        {/* Controls */}
        <div className="flex items-center gap-2">
          <Select
            value={lead.responseStatus}
            onValueChange={(value) =>
              onPatch(lead.id, { responseStatus: value as MonitoredLead["responseStatus"] })
            }
          >
            <SelectTrigger className="h-8 min-w-[140px] rounded-lg text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="reached_out">reached out</SelectItem>
              <SelectItem value="answered">answered</SelectItem>
              <SelectItem value="done">done</SelectItem>
            </SelectPopup>
          </Select>

          <Button
            variant="outline"
            className="h-8 gap-1.5 rounded-lg px-3 text-[0.84rem]"
            disabled={refreshMutation.isPending}
            onClick={() => refreshMutation.mutate({ monitoredLeadId: lead.id })}
          >
            {refreshMutation.isPending ? <Spinner className="size-3.5" /> : <RefreshCwIcon className="size-3.5" />}
            Refresh
          </Button>

          <a
            href={`https://x.com/${lead.handle}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex"
          >
            <Button variant="outline" className="h-8 gap-1.5 rounded-lg px-3 text-[0.84rem]">
              <ExternalLinkIcon className="size-3.5" />
              Profile
            </Button>
          </a>

          <Button
            variant="outline"
            className="ml-auto h-8 gap-1.5 rounded-lg px-3 text-[0.84rem] text-red-600 hover:bg-red-50 hover:text-red-700"
            onClick={() => onRemove(lead.id)}
          >
            <TrashIcon className="size-3.5" />
          </Button>
        </div>

        <Separator className="my-4" />

        {/* DM Chat */}
        <div className="text-[0.82rem] font-medium text-muted-foreground mb-2">
          DM Conversation
        </div>

        {dmQuery.isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Spinner className="size-4" />
            <span className="ml-2">Loading messages...</span>
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
            <p className="text-sm">No DM messages found.</p>
            <p className="mt-1 text-xs">
              {!lead.xUserId
                ? "Could not resolve X user ID for this handle."
                : "Either no conversation exists or the token lacks dm.read scope."}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2 max-h-[500px] overflow-y-auto pr-1">
            {events.map((event) => (
              <div
                key={event.id}
                className={cn(
                  "max-w-[85%] rounded-xl px-3.5 py-2.5 text-[0.88rem]",
                  event.isOwn
                    ? "ml-auto bg-foreground text-background"
                    : "mr-auto bg-muted",
                )}
              >
                <div className="break-words whitespace-pre-wrap">{event.text}</div>
                <div
                  className={cn(
                    "mt-1 text-[0.72rem]",
                    event.isOwn ? "text-background/60" : "text-muted-foreground/70",
                  )}
                >
                  {formatTime(event.createdAt)}
                </div>
              </div>
            ))}
          </div>
        )}

        {conversation?.lastFetched && (
          <div className="mt-3 text-center text-[0.72rem] text-muted-foreground/60">
            Last fetched: {formatTime(conversation.lastFetched)}
          </div>
        )}
      </SheetPanel>
    </>
  );
}

export function DMChatSheet({ lead, open, onOpenChange, onPatch, onRemove }: DMChatSheetProps) {
  if (!lead) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetPopup side="right">
        <DMChatContent lead={lead} onPatch={onPatch} onRemove={onRemove} />
      </SheetPopup>
    </Sheet>
  );
}
