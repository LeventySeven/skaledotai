"use client";

import { useEffect, useDeferredValue, useRef, useState } from "react";
import { toastManager } from "@/components/ui/toast";
import { trpc } from "@/lib/trpc/client";
import type { MonitoredLead } from "@/lib/validations/monitoring";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants";

type StatusFilter = "all" | "reached_out" | "answered" | "done";
type MonitoringSort = "followers-desc" | "followers-asc" | "name-asc" | "recent";

export function useMonitoringWorkspace() {
  const utils = trpc.useUtils();

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<MonitoringSort>("recent");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [allFilteredSelected, setAllFilteredSelected] = useState(false);
  const [selectedLead, setSelectedLead] = useState<MonitoredLead | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  const listInput = {
    page,
    pageSize: DEFAULT_PAGE_SIZE,
    search: deferredSearch,
    sort,
    status,
    monitoringOnly: false,
  };

  const listQuery = trpc.monitoring.list.useQuery(listInput);

  // Auto-refresh all ticked leads when page opens (once per mount)
  const autoRefreshed = useRef(false);
  const refreshAllMutation = trpc.monitoring.refreshAll.useMutation({
    onSuccess: (result) => {
      utils.monitoring.list.invalidate();
      if (result.checked > 0) {
        toastManager.add({
          type: "success",
          title: `Refreshed ${result.checked} leads, ${result.updated} updated.`,
        });
      }
    },
    onError: (error) => {
      toastManager.add({ type: "error", title: error.message });
    },
  });

  useEffect(() => {
    if (!autoRefreshed.current && listQuery.data && listQuery.data.total > 0) {
      autoRefreshed.current = true;
      refreshAllMutation.mutate();
    }
  }, [listQuery.data]);

  const updateMutation = trpc.monitoring.update.useMutation({
    onMutate: async ({ id, patch }) => {
      await utils.monitoring.list.cancel();
      utils.monitoring.list.setData(listInput, (old) => {
        if (!old) return old;
        return {
          ...old,
          leads: old.leads.map((l) =>
            l.id === id ? { ...l, ...patch } : l,
          ),
        };
      });
      setSelectedLead((current) =>
        current?.id === id ? { ...current, ...patch } : current,
      );
    },
    onError: (error) => {
      toastManager.add({ type: "error", title: error.message });
    },
    onSettled: () => {
      utils.monitoring.list.invalidate();
    },
  });

  const removeMutation = trpc.monitoring.remove.useMutation({
    onSuccess: () => {
      utils.monitoring.list.invalidate();
      setSheetOpen(false);
      toastManager.add({ type: "success", title: "Removed from monitoring." });
    },
    onError: (error) => {
      toastManager.add({ type: "error", title: error.message });
    },
  });

  const refreshSingleMutation = trpc.monitoring.refreshDms.useMutation({
    onSuccess: () => {
      setRefreshingId(null);
      utils.monitoring.list.invalidate();
      toastManager.add({ type: "success", title: "DMs updated." });
    },
    onError: (error) => {
      setRefreshingId(null);
      toastManager.add({ type: "error", title: error.message });
    },
  });

  const bulkUpdateMutation = trpc.monitoring.bulkUpdate.useMutation({
    onSuccess: () => {
      utils.monitoring.list.invalidate();
      clearSelection();
    },
    onError: (error) => {
      toastManager.add({ type: "error", title: error.message });
    },
  });

  const leads = listQuery.data?.leads ?? [];
  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / DEFAULT_PAGE_SIZE));

  const allVisibleSelected =
    allFilteredSelected ||
    (leads.length > 0 && leads.every((l) => selectedIds.includes(l.id)));
  const selectedCount = allFilteredSelected ? total : selectedIds.length;

  function handlePatch(id: string, patch: Partial<MonitoredLead>) {
    const input: { monitoring?: boolean; responseStatus?: "reached_out" | "answered" | "done" } = {};
    if ("monitoring" in patch) input.monitoring = patch.monitoring;
    if ("responseStatus" in patch) input.responseStatus = patch.responseStatus;
    updateMutation.mutate({ id, patch: input });
  }

  function handleRemove(id: string) {
    removeMutation.mutate({ id });
  }

  function handleRefreshAll() {
    refreshAllMutation.mutate();
  }

  function handleRefreshSingle(lead: MonitoredLead) {
    setRefreshingId(lead.id);
    refreshSingleMutation.mutate({ monitoredLeadId: lead.id });
  }

  function handleBulkStatus(status: "reached_out" | "answered" | "done") {
    const ids = allFilteredSelected ? leads.map((l) => l.id) : selectedIds;
    if (ids.length === 0) return;
    bulkUpdateMutation.mutate({ ids, patch: { responseStatus: status } });
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
    setSelectedIds(leads.map((l) => l.id));
  }

  function clearSelection() {
    setAllFilteredSelected(false);
    setSelectedIds([]);
  }

  function updateStatusFilter(next: StatusFilter) {
    setStatus(next);
    setPage(1);
  }

  function updateSort(next: MonitoringSort) {
    setSort(next);
  }

  function updateSearch(next: string) {
    setSearch(next);
    setPage(1);
  }

  function openLead(lead: MonitoredLead) {
    setSelectedLead(lead);
    setSheetOpen(true);
  }

  return {
    page,
    status,
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
    isRefreshingAll: refreshAllMutation.isPending,
    refreshingId,
    allVisibleSelected,
    allFilteredSelected,
    setPage,
    setSheetOpen,
    updateStatusFilter,
    updateSort,
    updateSearch,
    toggleRowSelection,
    toggleAllSelection,
    selectEntireSheet,
    clearSelection,
    openLead,
    handlePatch,
    handleRemove,
    handleRefreshAll,
    handleRefreshSingle,
    handleBulkStatus,
  };
}
