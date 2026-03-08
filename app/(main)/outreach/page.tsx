"use client";

import { useState, useEffect } from "react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import type { Lead } from "@/lib/types";

type Status = "pending" | "sent" | "replied";

function getStatus(lead: Lead): Status {
  if (lead.replied) return "replied";
  if (lead.hasDmed) return "sent";
  return "pending";
}

function initials(name: string): string {
  return name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

const STATUS_BADGE: Record<Status, { label: string; variant: "secondary" | "info" | "success" }> = {
  pending: { label: "Pending", variant: "secondary" },
  sent: { label: "Sent", variant: "info" },
  replied: { label: "Replied", variant: "success" },
};

const VARIABLES = ["{{name}}", "{{company}}", "{{platform}}"];

async function patchLead(id: string, data: Partial<Lead>) {
  await fetch(`/api/leads/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export default function OutreachPage() {
  const [queue, setQueue] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/leads?inOutreach=true&pageSize=1000")
      .then((r) => r.json())
      .then((d) => setQueue(d.leads ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [subject, setSubject] = useState("Quick note");
  const [body, setBody] = useState(
    "Hi {{name}},\n\nI came across your work and was really impressed.\n\nWould love to connect!\n\nBest,"
  );
  const [sending, setSending] = useState(false);

  const pendingLeads = queue.filter((l) => getStatus(l) === "pending");
  const allSelected = pendingLeads.length > 0 && pendingLeads.every((l) => selected.has(l.id));
  const someSelected = pendingLeads.some((l) => selected.has(l.id));

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) pendingLeads.forEach((l) => next.delete(l.id));
      else pendingLeads.forEach((l) => next.add(l.id));
      return next;
    });
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function removeFromQueue(lead: Lead) {
    await patchLead(lead.id, { inOutreach: false });
    setQueue((prev) => prev.filter((l) => l.id !== lead.id));
    setSelected((prev) => { const n = new Set(prev); n.delete(lead.id); return n; });
  }

  async function handleSend() {
    if (selected.size === 0) return;
    setSending(true);
    const count = selected.size;
    await Promise.all(
      queue.filter((l) => selected.has(l.id)).map((l) => patchLead(l.id, { hasDmed: true }))
    );
    setQueue((prev) => prev.map((l) => selected.has(l.id) ? { ...l, hasDmed: true } : l));
    setSelected(new Set());
    setSending(false);
    toastManager.add({ type: "success", title: `Marked ${count} lead${count > 1 ? "s" : ""} as sent.` });
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Outreach</h1>

      {/* Queue */}
      <section>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Leads in Queue</p>
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 px-4">
                  <Checkbox checked={allSelected}
                    data-state={someSelected && !allSelected ? "indeterminate" : undefined}
                    onCheckedChange={toggleAll} aria-label="Select all pending" />
                </TableHead>
                <TableHead className="w-10" />
                <TableHead>Name</TableHead>
                <TableHead className="hidden sm:table-cell">Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">Loading…</TableCell>
                </TableRow>
              ) : queue.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                    No leads in queue. Add some from the Leads page.
                  </TableCell>
                </TableRow>
              ) : (
                queue.map((lead) => {
                  const status = getStatus(lead);
                  const isPending = status === "pending";
                  const badge = STATUS_BADGE[status];
                  return (
                    <TableRow key={lead.id} className={!isPending ? "opacity-60" : undefined}>
                      <TableCell className="px-4">
                        <Checkbox checked={selected.has(lead.id)} onCheckedChange={() => toggleOne(lead.id)}
                          disabled={!isPending} aria-label={`Select ${lead.name}`} />
                      </TableCell>
                      <TableCell>
                        <Avatar className="size-8">
                          {lead.avatarUrl && <AvatarImage src={lead.avatarUrl} alt={lead.name} />}
                          <AvatarFallback className="text-xs">{initials(lead.name)}</AvatarFallback>
                        </Avatar>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium text-sm">{lead.name}</p>
                        <p className="text-xs text-muted-foreground">{lead.handle}</p>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">{lead.email ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={badge.variant} className="text-xs">{badge.label}</Badge>
                      </TableCell>
                      <TableCell>
                        {isPending ? (
                          <Button variant="ghost" size="sm"
                            className="h-7 text-xs text-destructive hover:text-destructive"
                            onClick={() => removeFromQueue(lead)}>
                            Remove
                          </Button>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <Separator />

      {/* Composer */}
      <section className="space-y-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Email Template</p>

        <div className="space-y-1.5">
          <Label htmlFor="subject">Subject</Label>
          <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Your email subject" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="body">Body</Label>
          <Textarea id="body" value={body} onChange={(e) => setBody(e.target.value)}
            rows={8} placeholder="Write your email…" className="resize-none" />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Variables:</span>
            {VARIABLES.map((v) => <Kbd key={v}>{v}</Kbd>)}
          </div>
        </div>

        <Button className="w-full sm:w-auto" disabled={selected.size === 0 || sending} onClick={handleSend}>
          {sending ? (
            <><Spinner className="size-4" />Sending…</>
          ) : selected.size > 0 ? (
            `Send to Selected (${selected.size})`
          ) : (
            "Send to Selected"
          )}
        </Button>
      </section>
    </div>
  );
}
