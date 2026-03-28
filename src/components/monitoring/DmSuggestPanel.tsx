"use client";

import { useState } from "react";
import {
  Sheet, SheetPopup, SheetHeader, SheetTitle, SheetDescription,
  SheetPanel,
} from "@/components/ui/sheet";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { CheckIcon, PlusIcon } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { toastManager } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

function formatFollowers(value?: number): string {
  if (value == null) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function initials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

interface DmSuggestPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}

function DmSuggestContent({ onAdded }: { onAdded: () => void }) {
  const utils = trpc.useUtils();
  const suggestQuery = trpc.monitoring.suggestFromDms.useQuery(undefined, {
    retry: false,
  });
  const addMutation = trpc.monitoring.addSuggestions.useMutation({
    onSuccess: (count) => {
      toastManager.add({ type: "success", title: `Added ${count} to monitoring.` });
      utils.monitoring.suggestFromDms.invalidate();
      utils.monitoring.list.invalidate();
      onAdded();
    },
    onError: (error) => {
      toastManager.add({ type: "error", title: error.message });
    },
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const suggestions = suggestQuery.data ?? [];
  const available = suggestions.filter((s) => !s.alreadyMonitored);

  function toggleSelection(xUserId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(xUserId)) {
        next.delete(xUserId);
      } else {
        next.add(xUserId);
      }
      return next;
    });
  }

  function handleAddSelected() {
    const toAdd = suggestions.filter((s) => selectedIds.has(s.xUserId));
    if (toAdd.length === 0) return;
    addMutation.mutate({
      suggestions: toAdd.map((s) => ({
        xUserId: s.xUserId,
        username: s.username,
        name: s.name,
        avatarUrl: s.avatarUrl,
        bio: s.bio,
        followers: s.followers,
      })),
    });
    setSelectedIds(new Set());
  }

  function handleAddSingle(suggestion: typeof suggestions[0]) {
    addMutation.mutate({
      suggestions: [{
        xUserId: suggestion.xUserId,
        username: suggestion.username,
        name: suggestion.name,
        avatarUrl: suggestion.avatarUrl,
        bio: suggestion.bio,
        followers: suggestion.followers,
      }],
    });
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>Suggest from DMs</SheetTitle>
        <SheetDescription>
          People you've DM'd on X. Click to add them to monitoring.
        </SheetDescription>
      </SheetHeader>

      <SheetPanel>
        {suggestQuery.isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Spinner className="size-4" />
            <span className="ml-2">Scanning your DMs...</span>
          </div>
        ) : suggestQuery.isError ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
            <p className="text-sm font-medium">Could not load DM contacts</p>
            <p className="mt-1 text-xs">{suggestQuery.error.message}</p>
          </div>
        ) : suggestions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
            <p className="text-sm">No DM conversations found.</p>
          </div>
        ) : (
          <>
            {selectedIds.size > 0 && (
              <div className="mb-3 flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2">
                <span className="text-[0.84rem] text-muted-foreground">
                  {selectedIds.size} selected
                </span>
                <Button
                  variant="default"
                  className="h-7 rounded-lg px-3 text-[0.82rem]"
                  disabled={addMutation.isPending}
                  onClick={handleAddSelected}
                >
                  {addMutation.isPending ? <Spinner className="size-3.5" /> : <PlusIcon className="size-3.5" />}
                  Add Selected
                </Button>
              </div>
            )}

            <div className="flex flex-col gap-1.5 max-h-[600px] overflow-y-auto pr-1">
              {suggestions.map((suggestion) => (
                <div
                  key={suggestion.xUserId}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors cursor-pointer",
                    suggestion.alreadyMonitored
                      ? "opacity-50"
                      : selectedIds.has(suggestion.xUserId)
                        ? "bg-accent"
                        : "hover:bg-muted/40",
                  )}
                  onClick={() => {
                    if (!suggestion.alreadyMonitored) {
                      toggleSelection(suggestion.xUserId);
                    }
                  }}
                >
                  <Avatar className="size-9 shrink-0">
                    {suggestion.avatarUrl && <AvatarImage src={suggestion.avatarUrl} alt={suggestion.name} />}
                    <AvatarFallback>{initials(suggestion.name || suggestion.username)}</AvatarFallback>
                  </Avatar>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[0.9rem] font-semibold">
                        {suggestion.name || suggestion.username}
                      </span>
                      {suggestion.followers != null && (
                        <span className="shrink-0 text-[0.78rem] text-muted-foreground">
                          {formatFollowers(suggestion.followers)}
                        </span>
                      )}
                    </div>
                    <div className="truncate text-[0.82rem] text-muted-foreground">
                      @{suggestion.username}
                    </div>
                    {suggestion.bio && (
                      <div className="mt-0.5 truncate text-[0.78rem] text-muted-foreground/70">
                        {suggestion.bio}
                      </div>
                    )}
                  </div>

                  {suggestion.alreadyMonitored ? (
                    <Badge variant="outline" className="shrink-0 h-6 rounded-sm border-transparent bg-green-100 px-1.5 text-[0.72rem] text-green-700">
                      <CheckIcon className="mr-0.5 size-3" />
                      Added
                    </Badge>
                  ) : (
                    <Button
                      variant="outline"
                      className="shrink-0 h-7 rounded-lg px-2.5 text-[0.78rem]"
                      disabled={addMutation.isPending}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAddSingle(suggestion);
                      }}
                    >
                      <PlusIcon className="size-3.5" />
                      Add
                    </Button>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-3 text-center text-[0.76rem] text-muted-foreground/60">
              {suggestions.length} contacts found &middot; {available.length} available
            </div>
          </>
        )}
      </SheetPanel>
    </>
  );
}

export function DmSuggestPanel({ open, onOpenChange, onAdded }: DmSuggestPanelProps) {
  if (!open) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetPopup side="right">
        <DmSuggestContent onAdded={onAdded} />
      </SheetPopup>
    </Sheet>
  );
}
