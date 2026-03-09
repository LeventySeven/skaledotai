"use client";

import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toastManager } from "@/components/ui/toast";
import { trpc } from "@/lib/trpc/client";
import type { Lead } from "@/lib/validations/leads";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants";

type LeadStageFilter = "all" | "found" | "messaged" | "replied" | "agreed";
type LeadSort = "followers-desc" | "followers-asc" | "name-asc";

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

export function useLeadsWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const utils = trpc.useUtils();
  const { data: projects = [] } = trpc.projects.list.useQuery();

  const projectParam = searchParams.get("project") ?? "";
  const [projectId, setProjectId] = useState(projectParam);
  const [page, setPage] = useState(1);
  const [stage, setStage] = useState<LeadStageFilter>("all");
  const [sort, setSort] = useState<LeadSort>("followers-desc");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [allFilteredSelected, setAllFilteredSelected] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    setProjectId(projectParam);
    setPage(1);
    setSelectedIds([]);
    setAllFilteredSelected(false);
  }, [projectParam]);

  const listQuery = trpc.leads.list.useQuery({
    page,
    pageSize: DEFAULT_PAGE_SIZE,
    projectId: projectId || undefined,
    search: deferredSearch,
    sort,
    stage,
  });

  const refreshStats = trpc.stats.refresh.useMutation();
  const enrichEmails = trpc.leads.enrichEmails.useMutation();
  const scanEmails = trpc.leads.scanEmails.useMutation();
  const updateLead = trpc.leads.update.useMutation({
    onSuccess: async (lead) => {
      setSelectedLead((current) => (current?.id === lead.id ? { ...current, ...lead } : current));
      await Promise.all([
        utils.leads.list.invalidate(),
        utils.outreach.list.invalidate(),
      ]);
    },
    onError: (error) => {
      toastManager.add({ type: "error", title: error.message });
    },
  });

  const leads = listQuery.data?.leads ?? [];
  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / DEFAULT_PAGE_SIZE));
  const currentProject = useMemo(
    () => projects.find((project) => project.id === projectId),
    [projectId, projects],
  );

  const allVisibleSelected = allFilteredSelected || (leads.length > 0 && leads.every((lead) => selectedIds.includes(lead.id)));
  const selectedCount = allFilteredSelected ? total : selectedIds.length;

  async function handlePatch(id: string, patch: Partial<Lead>) {
    await updateLead.mutateAsync({
      crmId: id,
      patch: toPatchInput(patch),
    });
  }

  function toggleRowSelection(leadId: string, checked: boolean) {
    setAllFilteredSelected(false);
    setSelectedIds((current) =>
      checked ? [...new Set([...current, leadId])] : current.filter((id) => id !== leadId),
    );
  }

  function toggleAllSelection(checked: boolean) {
    setAllFilteredSelected(false);
    setSelectedIds(checked ? leads.map((lead) => lead.id) : []);
  }

  function selectEntireSheet() {
    setAllFilteredSelected(true);
    setSelectedIds([]);
  }

  function clearSelection() {
    setAllFilteredSelected(false);
    setSelectedIds([]);
  }

  function updateProjectFilter(nextProjectId: string) {
    setProjectId(nextProjectId);
    const params = new URLSearchParams(searchParams.toString());
    if (nextProjectId) params.set("project", nextProjectId);
    else params.delete("project");

    startTransition(() => {
      router.replace(`/leads${params.toString() ? `?${params.toString()}` : ""}`);
    });
  }

  function updateStageFilter(nextStage: LeadStageFilter) {
    setStage(nextStage);
    setPage(1);
  }

  function updateSort(nextSort: LeadSort) {
    setSort(nextSort);
  }

  function updateSearch(nextSearch: string) {
    setSearch(nextSearch);
    setPage(1);
  }

  function openLead(lead: Lead) {
    setSelectedLead(lead);
    setSheetOpen(true);
  }

  async function handleScanBios() {
    const targetLeads = leads.filter((lead) => selectedIds.length === 0 || selectedIds.includes(lead.id));
    if (targetLeads.length === 0) return;

    for (const lead of targetLeads) {
      await refreshStats.mutateAsync({
        profileId: lead.id,
        crmId: lead.crmId,
        niche: currentProject?.query,
      });
    }

    await Promise.all([
      utils.stats.get.invalidate(),
      utils.leads.list.invalidate(),
    ]);
    toastManager.add({
      type: "success",
      title: `Scanned ${targetLeads.length} bios and refreshed priorities.`,
    });
  }

  async function handleEnrichEmails() {
    if (projectId) {
      const result = await scanEmails.mutateAsync({ projectId });
      await utils.leads.list.invalidate();
      toastManager.add({
        type: "success",
        title: `Enriched ${result.updated} emails in ${currentProject?.name ?? "project"}.`,
      });
      return;
    }

    if (selectedIds.length === 0) {
      toastManager.add({
        type: "info",
        title: "Select leads or open a project first.",
      });
      return;
    }

    const updated = await enrichEmails.mutateAsync({ crmIds: selectedIds });
    await utils.leads.list.invalidate();
    toastManager.add({
      type: "success",
      title: `Enriched ${updated} emails.`,
    });
  }

  return {
    projects,
    currentProject,
    projectId,
    page,
    stage,
    sort,
    search,
    selectedIds,
    selectedCount,
    selectedLead,
    sheetOpen,
    leads,
    total,
    totalPages,
    isLoading: listQuery.isLoading,
    isRefreshingStats: refreshStats.isPending,
    isEnrichingEmails: enrichEmails.isPending || scanEmails.isPending,
    allVisibleSelected,
    allFilteredSelected,
    setPage,
    setSheetOpen,
    updateProjectFilter,
    updateStageFilter,
    updateSort,
    updateSearch,
    toggleRowSelection,
    toggleAllSelection,
    selectEntireSheet,
    clearSelection,
    openLead,
    handlePatch,
    handleScanBios,
    handleEnrichEmails,
  };
}
