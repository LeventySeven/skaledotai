"use client";

import { type ChangeEvent, useMemo, useState } from "react";
import { MoreHorizontalIcon } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toastManager } from "@/components/ui/toast";
import { trpc } from "@/lib/trpc/client";
import type { Lead } from "@/lib/types";

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

function statusLabel(stage: Lead["stage"]): string {
  if (stage === "agreed") return "Agreed";
  if (stage === "replied") return "Replied";
  if (stage === "messaged") return "Messaged";
  return "Queued";
}

export function OutreachWorkspace() {
  const utils = trpc.useUtils();
  const listQuery = trpc.outreach.list.useQuery();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [subject, setSubject] = useState("Quick note");
  const [body, setBody] = useState(
    "Hi {{name}},\n\nI came across your work and was really impressed.\n\nWould love to connect!\n\nBest,",
  );

  const updateLead = trpc.leads.update.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.outreach.list.invalidate(),
        utils.leads.list.invalidate(),
      ]);
    },
    onError: (error) => {
      toastManager.add({ type: "error", title: error.message });
    },
  });

  const leads = listQuery.data ?? [];
  const selectedLeads = useMemo(
    () => leads.filter((lead) => selectedIds.includes(lead.id)),
    [leads, selectedIds],
  );

  function toggleLead(leadId: string, checked: boolean) {
    setSelectedIds((current) =>
      checked ? [...new Set([...current, leadId])] : current.filter((id) => id !== leadId),
    );
  }

  async function handleSendSelected() {
    if (selectedLeads.length === 0) {
      toastManager.add({ type: "info", title: "Select at least one lead." });
      return;
    }

    for (const lead of selectedLeads) {
      await updateLead.mutateAsync({
        crmId: lead.id,
        patch: toPatchInput({
          stage: "messaged",
          inOutreach: true,
          theAsk: `${subject}\n\n${body}`,
        }),
      });
    }

    toastManager.add({
      type: "success",
      title: `Marked ${selectedLeads.length} leads as messaged.`,
    });
    setSelectedIds([]);
  }

  return (
    <div className="mx-auto max-w-[1680px] px-8 py-8">
      <h1 className="text-[3rem] font-semibold tracking-[-0.04em]">Outreach</h1>

      <div className="mt-10">
        <div className="mb-3 text-[0.95rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Leads in queue
        </div>
        <div className="overflow-hidden rounded-[1.25rem] border border-border bg-card">
          <Table className="text-[1rem]">
            <TableHeader>
              <TableRow className="h-14 hover:bg-transparent">
                <TableHead className="w-[56px] px-5">
                  <Checkbox
                    checked={leads.length > 0 && leads.every((lead) => selectedIds.includes(lead.id))}
                    onCheckedChange={(value) => setSelectedIds(Boolean(value) ? leads.map((lead) => lead.id) : [])}
                  />
                </TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.length === 0 ? (
                <TableRow className="h-[140px] hover:bg-transparent">
                  <TableCell colSpan={5} className="text-center text-[1rem] text-muted-foreground">
                    No leads in queue. Add some from the Leads page.
                  </TableCell>
                </TableRow>
              ) : (
                leads.map((lead) => (
                  <TableRow key={lead.id} className="h-[70px] border-b">
                    <TableCell className="px-5">
                      <Checkbox
                        checked={selectedIds.includes(lead.id)}
                        onCheckedChange={(value) => toggleLead(lead.id, Boolean(value))}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{lead.name}</TableCell>
                    <TableCell className="text-muted-foreground">{lead.email ?? "—"}</TableCell>
                    <TableCell>{statusLabel(lead.stage)}</TableCell>
                    <TableCell className="text-right">
                      <button
                        type="button"
                        className="inline-flex size-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        onClick={() => {
                          updateLead.mutate({
                            crmId: lead.id,
                            patch: toPatchInput({ inOutreach: false }),
                          });
                        }}
                      >
                        <MoreHorizontalIcon className="size-5" />
                      </button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="my-9 h-px bg-border" />

      <div className="max-w-[1680px]">
        <div className="mb-5 text-[0.95rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Email template
        </div>
        <div className="space-y-5">
          <div className="space-y-2">
            <label className="block text-[1rem] font-semibold">Subject</label>
            <Input
              className="h-12 rounded-2xl text-[1rem]"
              value={subject}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setSubject(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="block text-[1rem] font-semibold">Body</label>
            <Textarea
              className="min-h-[240px] rounded-2xl text-[1rem]"
              value={body}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setBody(event.target.value)}
            />
          </div>

          <div className="flex items-center gap-3 text-[0.98rem] text-muted-foreground">
            <span>Variables:</span>
            {["{{name}}", "{{company}}", "{{platform}}"].map((variable) => (
              <span key={variable} className="rounded-md bg-muted px-2 py-0.5 font-semibold">
                {variable}
              </span>
            ))}
          </div>

          <Button
            className="h-12 rounded-2xl px-5 text-[1rem]"
            disabled={updateLead.isPending}
            onClick={() => {
              handleSendSelected().catch((error: unknown) => {
                toastManager.add({ type: "error", title: error instanceof Error ? error.message : "Failed to update outreach." });
              });
            }}
          >
            Send to Selected
          </Button>
        </div>
      </div>
    </div>
  );
}
