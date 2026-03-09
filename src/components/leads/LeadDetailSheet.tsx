"use client";

import { useState, useEffect } from "react";
import {
  Sheet, SheetPopup, SheetHeader, SheetTitle, SheetDescription,
  SheetPanel, SheetFooter,
} from "@/components/ui/sheet";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import type { Lead } from "@/lib/validations/leads";
import type { PostStats } from "@/lib/validations/stats";
import { cn } from "@/lib/utils";
import { BarChart2Icon } from "lucide-react";
import { trpc } from "@/lib/trpc/client";

interface LeadDetailSheetProps {
  lead: Lead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPatch: (id: string, data: Partial<Lead>) => Promise<void>;
  niche?: string;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

function initials(name: string): string {
  return name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

export function LeadDetailSheet({ lead, open, onOpenChange, onPatch, niche }: LeadDetailSheetProps) {
  const utils = trpc.useUtils();
  const [importing, setImporting] = useState(false);
  const [postStats, setPostStats] = useState<PostStats | null>(null);
  const statsQuery = trpc.stats.get.useQuery(
    { profileId: lead?.id ?? "00000000-0000-0000-0000-000000000000" },
    {
      enabled: open && Boolean(lead?.id),
    },
  );
  const refreshStats = trpc.stats.refresh.useMutation();
  const importNetwork = trpc.search.importNetwork.useMutation();

  useEffect(() => {
    setPostStats(statsQuery.data ?? null);
  }, [statsQuery.data, lead?.id]);

  async function handleImportFollowing() {
    if (!lead || lead.platform !== "twitter") return;
    setImporting(true);
    try {
      const result = await importNetwork.mutateAsync({
        username: lead.handle,
        projectId: lead.projectId,
        projectName: lead.projectName ?? `${lead.handle} network`,
      });
      await Promise.all([
        utils.projects.list.invalidate(),
        utils.leads.list.invalidate(),
      ]);
      toastManager.add({
        type: "success",
        title: `Imported ${result.leads.length} leads from @${lead.handle}.`,
      });
    } catch (err) {
      toastManager.add({
        type: "error",
        title: err instanceof Error ? err.message : "Import failed.",
      });
    } finally {
      setImporting(false);
    }
  }

  async function handleFetchStats() {
    if (!lead || lead.platform !== "twitter") return;
    try {
      const data = await refreshStats.mutateAsync({
        profileId: lead.id,
        crmId: lead.crmId,
        niche,
      });
      setPostStats(data.stats);
      await utils.stats.get.invalidate({ profileId: lead.id });
      if (data.priority) await onPatch(lead.id, { priority: data.priority });
      toastManager.add({ type: "success", title: `Stats fetched. AI set priority to ${data.priority}.` });
    } catch (err) {
      toastManager.add({ type: "error", title: err instanceof Error ? err.message : "Failed to fetch stats." });
    }
  }

  if (!lead) return null;

  const connectionRatio = lead.following && lead.following > 0
    ? (lead.followers / lead.following).toFixed(1)
    : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetPopup side="right">
        <SheetHeader>
          <div className="flex items-start gap-4 pr-8">
            <Avatar className="size-14 shrink-0">
              {lead.avatarUrl && <AvatarImage src={lead.avatarUrl} alt={lead.name} />}
              <AvatarFallback>{initials(lead.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <SheetTitle>{lead.name}</SheetTitle>
              <SheetDescription className="mt-0.5">{lead.bio}</SheetDescription>
              <div className="mt-2 flex gap-1.5">
                {lead.platform === "twitter" && <Badge variant="secondary" className="text-xs">X / Twitter</Badge>}
                {/* linkedin platform removed — X only */}
              </div>
            </div>
          </div>
        </SheetHeader>

        <SheetPanel>
          {/* Profile Stats */}
          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <span className="text-muted-foreground">Followers</span>
            <span className="font-medium">{formatNumber(lead.followers)}</span>
            {lead.following !== undefined && (
              <>
                <span className="text-muted-foreground">Following</span>
                <span className="font-medium">{formatNumber(lead.following)}</span>
              </>
            )}
            {connectionRatio && (
              <>
                <span className="text-muted-foreground">Follower ratio</span>
                <span className="font-medium">{connectionRatio}x</span>
              </>
            )}
          </div>

          {/* Post Stats */}
          {lead.platform === "twitter" && (
            <>
              <Separator className="my-4" />
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Post Stats</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-xs gap-1 px-2"
                    disabled={refreshStats.isPending}
                    onClick={handleFetchStats}
                  >
                    {refreshStats.isPending ? <Spinner className="size-3" /> : <BarChart2Icon className="size-3" />}
                    {refreshStats.isPending ? "Fetching..." : postStats ? "Refresh" : "Fetch Stats"}
                  </Button>
                </div>

                {statsQuery.isLoading && (
                  <p className="text-xs text-muted-foreground">Loading...</p>
                )}

                {!statsQuery.isLoading && !postStats && !refreshStats.isPending && (
                  <p className="text-xs text-muted-foreground">No stats yet. Click Fetch Stats to analyze recent X posts.</p>
                )}

                {postStats && (
                  <div className="grid grid-cols-2 gap-y-1.5 text-sm">
                    <span className="text-muted-foreground">Posts analyzed</span>
                    <span className="font-medium">{postStats.postCount}</span>
                    {postStats.avgViews !== undefined && (
                      <>
                        <span className="text-muted-foreground">Avg views</span>
                        <span className="font-medium">{formatNumber(postStats.avgViews)}</span>
                      </>
                    )}
                    {postStats.avgLikes !== undefined && (
                      <>
                        <span className="text-muted-foreground">Avg likes</span>
                        <span className="font-medium">{formatNumber(postStats.avgLikes)}</span>
                      </>
                    )}
                    {postStats.avgReplies !== undefined && (
                      <>
                        <span className="text-muted-foreground">Avg replies</span>
                        <span className="font-medium">{formatNumber(postStats.avgReplies)}</span>
                      </>
                    )}
                    {postStats.avgReposts !== undefined && (
                      <>
                        <span className="text-muted-foreground">Avg reposts</span>
                        <span className="font-medium">{formatNumber(postStats.avgReposts)}</span>
                      </>
                    )}
                    {postStats.topTopics && postStats.topTopics.length > 0 && (
                      <>
                        <span className="text-muted-foreground pt-1">Topics</span>
                        <div className="flex flex-wrap gap-1 pt-1">
                          {postStats.topTopics.map((t) => (
                            <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-xs">{t}</span>
                          ))}
                        </div>
                      </>
                    )}
                    <span className="text-muted-foreground text-xs col-span-2 pt-1 opacity-60">
                      Updated {new Date(postStats.fetchedAt).toLocaleDateString()}
                    </span>
                  </div>
                )}
              </div>
            </>
          )}

          <Separator className="my-4" />

          {/* CRM Fields */}
          <div className="space-y-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">CRM</p>

            {/* Priority */}
            <div className="flex items-center gap-3">
              <span className="w-36 shrink-0 text-sm text-muted-foreground">Priority</span>
              <div className="flex gap-1.5">
                {(["P0", "P1"] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => onPatch(lead.id, { priority: p })}
                    className={cn(
                      "rounded px-2 py-0.5 text-xs font-semibold transition-colors",
                      lead.priority === p
                        ? p === "P0" ? "bg-orange-100 text-orange-700" : "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* DM Comfort */}
            <div className="flex items-center gap-3">
              <Label htmlFor="dm-comfort" className="w-36 shrink-0 text-sm text-muted-foreground font-normal cursor-pointer">
                Comfortable DMing?
              </Label>
              <Checkbox id="dm-comfort" checked={lead.dmComfort}
                onCheckedChange={(v) => onPatch(lead.id, { dmComfort: Boolean(v) })} />
            </div>

            {/* Stage */}
            <div className="flex items-center gap-3">
              <Label className="w-36 shrink-0 text-sm text-muted-foreground font-normal">Stage</Label>
              <select
                value={lead.stage}
                onChange={(e) => onPatch(lead.id, { stage: e.target.value as Lead["stage"] })}
                className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="found">Found</option>
                <option value="messaged">Messaged</option>
                <option value="replied">Replied</option>
                <option value="agreed">Agreed</option>
              </select>
            </div>

            {/* The Ask */}
            <div className="space-y-1.5">
              <Label htmlFor="the-ask" className="text-sm text-muted-foreground font-normal">The Ask</Label>
              <Textarea
                id="the-ask"
                defaultValue={lead.theAsk}
                placeholder="What are you asking them for?"
                rows={3}
                className="resize-none text-sm"
                onBlur={(e) => {
                  if (e.target.value !== lead.theAsk) {
                    onPatch(lead.id, { theAsk: e.target.value });
                  }
                }}
              />
            </div>

            {/* Budget */}
            <div className="flex items-center gap-3">
              <Label htmlFor="budget" className="w-36 shrink-0 text-sm text-muted-foreground font-normal">
                Budget ($)
              </Label>
              <Input
                id="budget"
                type="number"
                min={0}
                step={1}
                defaultValue={lead.budget ?? ""}
                placeholder="0"
                className="w-28 text-sm h-8"
                onBlur={(e) => {
                  const val = e.target.value === "" ? undefined : Number(e.target.value);
                  if (val !== lead.budget) onPatch(lead.id, { budget: val });
                }}
              />
            </div>
          </div>

          <Separator className="my-4" />

          {/* Links */}
          <div className="space-y-1 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Links</p>
            {lead.profileUrl && (
              <a href={lead.profileUrl} target="_blank" rel="noopener noreferrer"
                className="block text-foreground underline underline-offset-4 hover:text-primary">
                {lead.profileUrl.replace(/^https?:\/\//, "")}
              </a>
            )}
          </div>

          <Separator className="my-4" />

          {/* Email */}
          <div className="text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Email</p>
            <p className="mt-1">
              {lead.email ?? <span className="text-muted-foreground">Not enriched yet</span>}
            </p>
          </div>
        </SheetPanel>

        <SheetFooter variant="bare">
          <div className="flex flex-col gap-2 w-full">
            {lead.platform === "twitter" && (
              <Button variant="outline" className="w-full" disabled={importing} onClick={handleImportFollowing}>
                {importing ? <><Spinner className="size-4" />Importing...</> : "Import Followers & Following"}
              </Button>
            )}
            <Button className="w-full" disabled={lead.inOutreach}
              onClick={() => onPatch(lead.id, { inOutreach: true })}>
              {lead.inOutreach ? "Already in Outreach" : "Add to Outreach"}
            </Button>
          </div>
        </SheetFooter>
      </SheetPopup>
    </Sheet>
  );
}
