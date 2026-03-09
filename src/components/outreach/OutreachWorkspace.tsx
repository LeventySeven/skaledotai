"use client";

import { useState } from "react";
import { SendIcon, Undo2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toastManager } from "@/components/ui/toast";
import { LeadDetailSheet } from "@/components/leads/LeadDetailSheet";
import { trpc } from "@/lib/trpc/client";
import type { Lead } from "@/lib/types";

function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
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

export function OutreachWorkspace() {
  const utils = trpc.useUtils();
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const listQuery = trpc.outreach.list.useQuery();
  const updateLead = trpc.leads.update.useMutation({
    onSuccess: async (lead) => {
      setSelectedLead((current) => (current?.id === lead.id ? { ...current, ...lead } : current));
      await Promise.all([
        utils.outreach.list.invalidate(),
        utils.leads.list.invalidate(),
      ]);
    },
    onError: (error) => {
      toastManager.add({ type: "error", title: error.message });
    },
  });

  async function handlePatch(id: string, patch: Partial<Lead>) {
    await updateLead.mutateAsync({
      crmId: id,
      patch: toPatchInput(patch),
    });
  }

  const leads = listQuery.data ?? [];

  return (
    <div className="space-y-6 p-6 md:p-8">
      <section className="rounded-3xl border bg-card p-6 shadow-sm/5">
        <p className="text-sm font-medium text-muted-foreground">Outreach queue</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Accounts ready for outreach</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          This is the current queue backed by the existing `in_outreach` lead state. Update stage progression here without changing the backend shape.
        </p>
      </section>

      <section className="rounded-2xl border bg-card shadow-sm/5">
        {listQuery.isLoading ? (
          <div className="flex items-center justify-center p-10 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            <span className="ml-2">Loading outreach queue...</span>
          </div>
        ) : leads.length === 0 ? (
          <Empty className="py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SendIcon />
              </EmptyMedia>
              <EmptyTitle>No queued leads</EmptyTitle>
              <EmptyDescription>
                Add leads to outreach from the leads page or the lead detail sheet.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lead</TableHead>
                <TableHead>Followers</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((lead) => (
                <TableRow
                  key={lead.id}
                  className="cursor-pointer"
                  onClick={() => {
                    setSelectedLead(lead);
                    setSheetOpen(true);
                  }}
                >
                  <TableCell>
                    <div>
                      <p className="font-medium">{lead.name}</p>
                      <p className="text-sm text-muted-foreground">@{lead.handle}</p>
                    </div>
                  </TableCell>
                  <TableCell>{formatNumber(lead.followers)}</TableCell>
                  <TableCell>
                    <Badge variant={lead.priority === "P0" ? "warning" : "outline"}>
                      {lead.priority}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <select
                      className="flex h-8 rounded-md border border-input bg-background px-2 text-sm"
                      value={lead.stage}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => {
                        handlePatch(lead.id, {
                          stage: event.target.value as Lead["stage"],
                        }).catch(() => undefined);
                      }}
                    >
                      <option value="found">Found</option>
                      <option value="messaged">Messaged</option>
                      <option value="replied">Replied</option>
                      <option value="agreed">Agreed</option>
                    </select>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={(event) => {
                          event.stopPropagation();
                          handlePatch(lead.id, { inOutreach: false }).catch(() => undefined);
                        }}
                      >
                        <Undo2Icon className="size-3.5" />
                        Remove
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <LeadDetailSheet
        lead={selectedLead}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onPatch={handlePatch}
      />
    </div>
  );
}
