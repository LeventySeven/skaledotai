"use client";

import { useDeferredValue, useState } from "react";
import { toastManager } from "@/components/ui/toast";
import { trpc } from "@/lib/trpc/client";
import type { ContraLead } from "@/lib/validations/contra";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants";

type StageFilter = "all" | "found" | "messaged" | "replied" | "agreed";
type ContraSort = "followers-desc" | "followers-asc" | "name-asc" | "price-desc";
type RelevancyFilter = "all" | "high" | "low";
type SourceFilter = "all" | "internal" | "influencer";

function toPatchInput(patch: Partial<ContraLead>) {
  const payload: {
    stage?: ContraLead["stage"];
    priority?: ContraLead["priority"];
    dmComfort?: boolean;
    theAsk?: string;
    inOutreach?: boolean;
    email?: string | null;
    reachedOut?: boolean;
    notes?: string | null;
    price?: number | null;
  } = {};

  if ("stage" in patch) payload.stage = patch.stage;
  if ("priority" in patch) payload.priority = patch.priority;
  if ("dmComfort" in patch) payload.dmComfort = patch.dmComfort;
  if ("theAsk" in patch) payload.theAsk = patch.theAsk;
  if ("inOutreach" in patch) payload.inOutreach = patch.inOutreach;
  if ("email" in patch) payload.email = patch.email ?? null;
  if ("reachedOut" in patch) payload.reachedOut = patch.reachedOut;
  if ("notes" in patch) payload.notes = patch.notes ?? null;
  if ("price" in patch) payload.price = patch.price ?? null;

  return payload;
}

/** Apply a patch to a lead, converting nulls to undefined to match ContraLead types. */
function applyPatch(lead: ContraLead, patch: Record<string, unknown>): ContraLead {
  const merged = { ...lead };
  for (const [key, value] of Object.entries(patch)) {
    (merged as Record<string, unknown>)[key] = value === null ? undefined : value;
  }
  return merged;
}

export function useContraWorkspace() {
  const utils = trpc.useUtils();

  const [page, setPage] = useState(1);
  const [stage, setStage] = useState<StageFilter>("all");
  const [sort, setSort] = useState<ContraSort>("followers-desc");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [relevancy, setRelevancy] = useState<RelevancyFilter>("all");
  const [source, setSource] = useState<SourceFilter>("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [allFilteredSelected, setAllFilteredSelected] = useState(false);
  const [selectedLead, setSelectedLead] = useState<ContraLead | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const listQuery = trpc.contra.list.useQuery({
    page,
    pageSize: DEFAULT_PAGE_SIZE,
    search: deferredSearch,
    sort,
    stage,
    relevancy,
    source,
  });

  const listInput = {
    page,
    pageSize: DEFAULT_PAGE_SIZE,
    search: deferredSearch,
    sort,
    stage,
    relevancy,
    source,
  };

  const updateLead = trpc.contra.update.useMutation({
    onMutate: async ({ id, patch }) => {
      await utils.contra.list.cancel();

      const previousList = utils.contra.list.getData(listInput);
      const previousSelectedLead = selectedLead;

      // Optimistically update the list cache
      utils.contra.list.setData(listInput, (old) => {
        if (!old) return old;
        return {
          ...old,
          leads: old.leads.map((l) => (l.id === id ? applyPatch(l, patch) : l)),
        };
      });

      // Optimistically update the detail sheet
      setSelectedLead((current) => (current?.id === id ? applyPatch(current, patch) : current));

      return { previousList, previousSelectedLead };
    },
    onError: (error, _variables, context) => {
      if (context?.previousList !== undefined) {
        utils.contra.list.setData(listInput, context.previousList);
      }
      if (context?.previousSelectedLead !== undefined) {
        setSelectedLead(context.previousSelectedLead);
      }
      toastManager.add({ type: "error", title: error.message });
    },
    onSettled: () => {
      utils.contra.list.invalidate();
    },
  });

  const leads = listQuery.data?.leads ?? [];
  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / DEFAULT_PAGE_SIZE));

  const allVisibleSelected = allFilteredSelected || (leads.length > 0 && leads.every((l) => selectedIds.includes(l.id)));
  const selectedCount = allFilteredSelected ? total : selectedIds.length;

  function handlePatch(id: string, patch: Partial<ContraLead>) {
    updateLead.mutate({ id, patch: toPatchInput(patch) });
  }

  function toggleRowSelection(leadId: string, checked: boolean) {
    setAllFilteredSelected(false);
    setSelectedIds((current) =>
      checked ? [...new Set([...current, leadId])] : current.filter((id) => id !== leadId),
    );
  }

  function toggleAllSelection(checked: boolean) {
    setAllFilteredSelected(false);
    setSelectedIds(checked ? leads.map((l) => l.id) : []);
  }

  function selectEntireSheet() {
    setAllFilteredSelected(true);
    setSelectedIds([]);
  }

  function clearSelection() {
    setAllFilteredSelected(false);
    setSelectedIds([]);
  }

  function updateStageFilter(nextStage: StageFilter) {
    setStage(nextStage);
    setPage(1);
  }

  function updateSort(nextSort: ContraSort) {
    setSort(nextSort);
  }

  function updateSearch(nextSearch: string) {
    setSearch(nextSearch);
    setPage(1);
  }

  function updateRelevancy(next: RelevancyFilter) {
    setRelevancy(next);
    setPage(1);
  }

  function updateSource(next: SourceFilter) {
    setSource(next);
    setPage(1);
  }

  function openLead(lead: ContraLead) {
    setSelectedLead(lead);
    setSheetOpen(true);
  }

  return {
    page,
    stage,
    sort,
    search,
    relevancy,
    source,
    selectedIds,
    selectedCount,
    selectedLead,
    sheetOpen,
    leads,
    total,
    totalPages,
    isLoading: listQuery.isLoading,
    allVisibleSelected,
    allFilteredSelected,
    setPage,
    setSheetOpen,
    updateStageFilter,
    updateSort,
    updateSearch,
    updateRelevancy,
    updateSource,
    toggleRowSelection,
    toggleAllSelection,
    selectEntireSheet,
    clearSelection,
    openLead,
    handlePatch,
  };
}
