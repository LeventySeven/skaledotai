"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Pagination, PaginationContent, PaginationItem,
  PaginationLink, PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent,
} from "@/components/ui/empty";
import {
  Tooltip, TooltipProvider, TooltipTrigger, TooltipPopup,
} from "@/components/ui/tooltip";
import {
  Menu, MenuTrigger, MenuPopup, MenuItem, MenuSeparator,
} from "@/components/ui/menu";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { LeadDetailSheet } from "@/components/leads/LeadDetailSheet";
import type { Lead, Project } from "@/lib/types";
import { MoreHorizontalIcon, SearchIcon } from "lucide-react";
import { cn } from "@/lib/utils";

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

function initials(name: string): string {
  return name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

const PAGE_SIZE = 25;

function LeadsPageInner() {
  const searchParams = useSearchParams();
  const projectIdFromUrl = searchParams.get("project");

  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [enriching, setEnriching] = useState(false);
  const [scanningBios, setScanningBios] = useState(false);
  const [bioScanResult, setBioScanResult] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [sort, setSort] = useState("followers-desc");
  const [page, setPage] = useState(1);
  const [detailLead, setDetailLead] = useState<Lead | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectFilter, setProjectFilter] = useState<string>(projectIdFromUrl ?? "all");

  // Load projects for the filter dropdown
  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => setProjects(Array.isArray(d) ? d : []))
      .catch(console.error);
  }, []);

  // Sync project filter when URL changes
  useEffect(() => {
    setProjectFilter(projectIdFromUrl ?? "all" as string);
    setPage(1);
  }, [projectIdFromUrl]);

  const fetchLeads = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      platform: platformFilter,
      sort,
      search,
    });
    const url = projectFilter && projectFilter !== "all"
      ? `/api/projects/${projectFilter}?${params}`
      : `/api/leads?${params}`;
    fetch(url)
      .then((r) => r.json())
      .then((d) => { setLeads(d.leads ?? []); setTotal(d.total ?? 0); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [page, platformFilter, sort, search, projectFilter]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const paginated = leads;
  const allSelected = paginated.length > 0 && paginated.every((l) => selected.has(l.id));
  const someSelected = paginated.some((l) => selected.has(l.id));

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) paginated.forEach((l) => next.delete(l.id));
      else paginated.forEach((l) => next.add(l.id));
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

  async function patch(id: string, data: Partial<Lead>) {
    await fetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...data } : l)));
    if (detailLead?.id === id) setDetailLead((p) => p ? { ...p, ...data } : p);
  }

  async function handleEnrich() {
    const selectedLeads = leads.filter((l) => selected.has(l.id));
    if (!selectedLeads.length) return;
    setEnriching(true);
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leads: selectedLeads.map((l) => ({ id: l.id, linkedinUrl: l.linkedinUrl, bio: l.bio })) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      // Response is now id→email map
      setLeads((prev) =>
        prev.map((l) => {
          const email = data.emails[l.id];
          return email ? { ...l, email } : l;
        })
      );
    } catch (err) {
      console.error("[enrich]", err);
    } finally {
      setEnriching(false);
    }
  }

  async function handleScanBios() {
    setScanningBios(true);
    setBioScanResult(null);
    try {
      const res = await fetch("/api/enrich-bios", { method: "POST" });
      const data = await res.json();
      setBioScanResult(data.updated ?? 0);
      fetchLeads();
    } catch (err) {
      console.error("[scan-bios]", err);
    } finally {
      setScanningBios(false);
    }
  }

  async function handleRemove(id: string) {
    await fetch(`/api/leads?id=${id}`, { method: "DELETE" });
    setLeads((prev) => prev.filter((l) => l.id !== id));
    setSelected((prev) => { const n = new Set(prev); n.delete(id); return n; });
  }

  function openDetail(lead: Lead) {
    setDetailLead(lead);
    setSheetOpen(true);
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-0 p-4 md:p-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
            {projectFilter !== "all" ? (projects.find((p) => p.id === projectFilter)?.name ?? "Leads") : "Leads"}
          </h1>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger render={<span />}>
                <Button variant="outline" size="sm" disabled={scanningBios} onClick={handleScanBios} className="hidden sm:flex">
                  {scanningBios
                    ? <><Spinner className="size-3.5" />Scanning…</>
                    : bioScanResult !== null
                      ? `Scan Bios (${bioScanResult} found)`
                      : "Scan Bios"}
                </Button>
              </TooltipTrigger>
              <TooltipPopup>Scans all lead bios for email addresses — free &amp; instant</TooltipPopup>
            </Tooltip>
            <Button variant="outline" size="sm" disabled={selected.size === 0 || enriching} onClick={handleEnrich}>
              {enriching ? <><Spinner className="size-3.5" />Enriching…</> : `Enrich${selected.size > 0 ? ` (${selected.size})` : " Emails"}`}
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex flex-wrap gap-2">
            <Select value={projectFilter} onValueChange={(v) => { setProjectFilter(v ?? "all"); setPage(1); }}>
              <SelectTrigger className="w-[160px] sm:w-[180px]">
                <span className="truncate">
                  {projectFilter === "all"
                    ? "All Projects"
                    : (projects.find((p) => p.id === projectFilter)?.name ?? "Loading…")}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Projects</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={platformFilter} onValueChange={(v) => { if (v) { setPlatformFilter(v); setPage(1); } }}>
              <SelectTrigger className="w-[140px] sm:w-[160px]"><SelectValue placeholder="Platform" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Platforms</SelectItem>
                <SelectItem value="twitter">X / Twitter</SelectItem>
                <SelectItem value="linkedin">LinkedIn</SelectItem>
              </SelectContent>
            </Select>

            <Select value={sort} onValueChange={(v) => { if (v) { setSort(v); setPage(1); } }}>
              <SelectTrigger className="w-[140px] sm:w-[180px]"><SelectValue placeholder="Sort" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="followers-desc">Followers ↓</SelectItem>
                <SelectItem value="followers-asc">Followers ↑</SelectItem>
                <SelectItem value="name-asc">Name A–Z</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="relative sm:ml-auto sm:w-[220px]">
            <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search leads…" className="pl-8" value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
        </div>

        {/* Table — md and up */}
        <div className="mt-4 hidden rounded-lg border md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 px-4">
                  <Checkbox checked={allSelected}
                    data-state={someSelected && !allSelected ? "indeterminate" : undefined}
                    onCheckedChange={toggleAll} aria-label="Select all" />
                </TableHead>
                <TableHead className="w-10" />
                <TableHead>Name</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead className="hidden lg:table-cell">Bio</TableHead>
                <TableHead>Followers</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead className="hidden lg:table-cell">DMed</TableHead>
                <TableHead className="hidden lg:table-cell">Replied</TableHead>
                <TableHead className="hidden xl:table-cell">Email</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 10 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full rounded" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : paginated.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="p-0">
                    <Empty>
                      <EmptyHeader>
                        <EmptyTitle>No leads yet</EmptyTitle>
                        <EmptyDescription>Run a search to find people in your niche.</EmptyDescription>
                      </EmptyHeader>
                      <EmptyContent>
                        <Button variant="outline" size="sm" render={<Link href="/search" />}>Go to Search</Button>
                      </EmptyContent>
                    </Empty>
                  </TableCell>
                </TableRow>
              ) : (
                paginated.map((lead) => (
                  <TableRow key={lead.id} className="cursor-pointer hover:bg-muted/40" onClick={() => openDetail(lead)}>
                    <TableCell className="px-4" onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={selected.has(lead.id)} onCheckedChange={() => toggleOne(lead.id)} aria-label={`Select ${lead.name}`} />
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Avatar className="size-8">
                        {lead.avatarUrl && <AvatarImage src={lead.avatarUrl} alt={lead.name} />}
                        <AvatarFallback className="text-xs">{initials(lead.name)}</AvatarFallback>
                      </Avatar>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm">{lead.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {lead.platform === "linkedin"
                            ? (lead.linkedinUrl
                                ? `linkedin.com/in/${lead.linkedinUrl.split("/in/").pop()?.replace(/\/$/, "")}`
                                : "LinkedIn")
                            : lead.handle}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      {lead.platform === "twitter"
                        ? <Badge variant="secondary" className="text-xs">X</Badge>
                        : <Badge variant="info" className="text-xs">LI</Badge>}
                    </TableCell>
                    <TableCell className="hidden max-w-[200px] truncate text-sm text-muted-foreground lg:table-cell">
                      {lead.bio}
                    </TableCell>
                    <TableCell className="text-sm">{formatNumber(lead.followers)}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <button
                        className={cn(
                          "rounded px-1.5 py-0.5 text-xs font-semibold transition-colors",
                          lead.priority === "P0"
                            ? "bg-orange-100 text-orange-700 hover:bg-orange-200"
                            : "bg-muted text-muted-foreground hover:bg-muted/80"
                        )}
                        onClick={() => patch(lead.id, { priority: lead.priority === "P0" ? "P1" : "P0" })}
                        title="Click to toggle priority"
                      >
                        {lead.priority}
                      </button>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell" onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={lead.hasDmed} onCheckedChange={(v) => patch(lead.id, { hasDmed: Boolean(v) })} aria-label="Has DMed" />
                    </TableCell>
                    <TableCell className="hidden lg:table-cell" onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={lead.replied} onCheckedChange={(v) => patch(lead.id, { replied: Boolean(v) })} aria-label="Replied" />
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">
                      {lead.email ? (
                        <Tooltip>
                          <TooltipTrigger render={<span className="max-w-[140px] truncate block text-sm cursor-default" />}>
                            {lead.email}
                          </TooltipTrigger>
                          <TooltipPopup>{lead.email}</TooltipPopup>
                        </Tooltip>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Menu>
                        <MenuTrigger render={<Button variant="ghost" size="icon" className="size-7" aria-label="Actions" />}>
                          <MoreHorizontalIcon className="size-4" />
                        </MenuTrigger>
                        <MenuPopup align="end">
                          <MenuItem onSelect={() => openDetail(lead)}>View Details</MenuItem>
                          <MenuItem onSelect={() => patch(lead.id, { inOutreach: true })} disabled={lead.inOutreach}>
                            {lead.inOutreach ? "In Outreach" : "Add to Outreach"}
                          </MenuItem>
                          <MenuSeparator />
                          <MenuItem variant="destructive" onSelect={() => handleRemove(lead.id)}>Remove Lead</MenuItem>
                        </MenuPopup>
                      </Menu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Card list — mobile only */}
        <div className="mt-4 flex flex-col gap-2 md:hidden">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg border p-3">
                <Skeleton className="size-9 rounded-full shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-32 rounded" />
                  <Skeleton className="h-3 w-20 rounded" />
                </div>
              </div>
            ))
          ) : paginated.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No leads yet</EmptyTitle>
                <EmptyDescription>Run a search to find people in your niche.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="outline" size="sm" render={<Link href="/search" />}>Go to Search</Button>
              </EmptyContent>
            </Empty>
          ) : (
            paginated.map((lead) => (
              <div
                key={lead.id}
                className="flex items-center gap-3 rounded-lg border bg-background p-3 active:bg-muted/40 cursor-pointer"
                onClick={() => openDetail(lead)}
              >
                <div onClick={(e) => e.stopPropagation()}>
                  <Checkbox checked={selected.has(lead.id)} onCheckedChange={() => toggleOne(lead.id)} aria-label={`Select ${lead.name}`} />
                </div>
                <Avatar className="size-9 shrink-0">
                  {lead.avatarUrl && <AvatarImage src={lead.avatarUrl} alt={lead.name} />}
                  <AvatarFallback className="text-xs">{initials(lead.name)}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="font-medium text-sm truncate">{lead.name}</p>
                    {lead.platform === "twitter"
                      ? <Badge variant="secondary" className="text-xs shrink-0">X</Badge>
                      : <Badge variant="info" className="text-xs shrink-0">LI</Badge>}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    <span>{formatNumber(lead.followers)}</span>
                    {lead.email && <span className="truncate">{lead.email}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button
                    className={cn(
                      "rounded px-1.5 py-0.5 text-xs font-semibold",
                      lead.priority === "P0"
                        ? "bg-orange-100 text-orange-700"
                        : "bg-muted text-muted-foreground"
                    )}
                    onClick={() => patch(lead.id, { priority: lead.priority === "P0" ? "P1" : "P0" })}
                  >
                    {lead.priority}
                  </button>
                  <Menu>
                    <MenuTrigger render={<Button variant="ghost" size="icon" className="size-7" aria-label="Actions" />}>
                      <MoreHorizontalIcon className="size-4" />
                    </MenuTrigger>
                    <MenuPopup align="end">
                      <MenuItem onSelect={() => openDetail(lead)}>View Details</MenuItem>
                      <MenuItem onSelect={() => patch(lead.id, { inOutreach: true })} disabled={lead.inOutreach}>
                        {lead.inOutreach ? "In Outreach" : "Add to Outreach"}
                      </MenuItem>
                      <MenuSeparator />
                      <MenuItem variant="destructive" onSelect={() => handleRemove(lead.id)}>Remove Lead</MenuItem>
                    </MenuPopup>
                  </Menu>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Pagination */}
        <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
          <span>{total.toLocaleString()} leads</span>
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious onClick={() => setPage((p) => Math.max(1, p - 1))}
                  aria-disabled={page === 1} className={page === 1 ? "pointer-events-none opacity-50" : ""} />
              </PaginationItem>
              {(() => {
                const pages: (number | "…")[] = [];
                if (totalPages <= 5) {
                  for (let i = 1; i <= totalPages; i++) pages.push(i);
                } else {
                  pages.push(1);
                  if (page > 3) pages.push("…");
                  for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
                  if (page < totalPages - 2) pages.push("…");
                  pages.push(totalPages);
                }
                return pages.map((p, i) =>
                  p === "…" ? (
                    <PaginationItem key={`ellipsis-${i}`}>
                      <span className="px-2 text-muted-foreground">…</span>
                    </PaginationItem>
                  ) : (
                    <PaginationItem key={p}>
                      <PaginationLink isActive={page === p} onClick={() => setPage(p as number)}>{p}</PaginationLink>
                    </PaginationItem>
                  )
                );
              })()}
              <PaginationItem>
                <PaginationNext onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  aria-disabled={page === totalPages} className={page === totalPages ? "pointer-events-none opacity-50" : ""} />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      </div>

      <LeadDetailSheet lead={detailLead} open={sheetOpen} onOpenChange={setSheetOpen} onPatch={patch} />
    </TooltipProvider>
  );
}

export default function LeadsPage() {
  return (
    <Suspense>
      <LeadsPageInner />
    </Suspense>
  );
}
