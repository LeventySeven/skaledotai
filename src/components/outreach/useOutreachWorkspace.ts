"use client";

import { useRef, useMemo, useState } from "react";
import { toastManager } from "@/components/ui/toast";
import { trpc } from "@/lib/trpc/client";
import type { Lead } from "@/lib/validations/leads";
import type { OutreachTemplate } from "@/lib/validations/outreach";

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

function applyTemplate(template: OutreachTemplate, lead: Lead): string {
  return `${template.subject}\n\n${template.body
    .replaceAll("{{name}}", lead.name)
    .replaceAll("{{platform}}", "X")
    .replaceAll("{{company}}", "")}`;
}

interface UseOutreachWorkspaceOptions {
  initialStandardTemplates?: OutreachTemplate[];
  initialSavedTemplates?: OutreachTemplate[];
}

export function useOutreachWorkspace(options?: UseOutreachWorkspaceOptions) {
  const utils = trpc.useUtils();
  const listQuery = trpc.outreach.list.useQuery();
  const templatesQuery = trpc.outreach.templates.useQuery(undefined, {
    initialData: options?.initialStandardTemplates,
  });
  const savedTemplatesQuery = trpc.outreach.savedTemplates.useQuery(undefined, {
    initialData: options?.initialSavedTemplates,
  });
  const { data: projects = [] } = trpc.projects.list.useQuery();

  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>(["standard-1"]);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const hasUserToggledProjects = useRef(false);
  const [stylePrompt, setStylePrompt] = useState("");
  const [importProjectId, setImportProjectId] = useState("");
  const [uiError, setUiError] = useState<string | null>(null);

  const effectiveProjectIds =
    hasUserToggledProjects.current || selectedProjectIds.length > 0
      ? selectedProjectIds
      : projects.map((p) => p.id);

  const effectiveImportProjectId = importProjectId || projects[0]?.id || "";

  const updateLead = trpc.leads.update.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.outreach.list.invalidate(),
        utils.leads.list.invalidate(),
      ]);
    },
    onError: (error) => {
      setUiError(error.message);
      toastManager.add({ type: "error", title: error.message });
    },
  });

  const bulkUpdateLeads = trpc.leads.bulkUpdate.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.outreach.list.invalidate(),
        utils.leads.list.invalidate(),
      ]);
    },
    onError: (error) => {
      setUiError(error.message);
      toastManager.add({ type: "error", title: error.message });
    },
  });

  const queueAllLeads = trpc.projects.queueAllLeads.useMutation({
    onSuccess: async (result) => {
      await Promise.all([
        utils.outreach.list.invalidate(),
        utils.leads.list.invalidate(),
      ]);
      toastManager.add({ type: "success", title: `Imported ${result.queued} leads from folder.` });
    },
    onError: (error) => {
      setUiError(error.message);
      toastManager.add({ type: "error", title: error.message });
    },
  });

  const generateTemplate = trpc.outreach.generateTemplate.useMutation({
    onSuccess: async (saved) => {
      await utils.outreach.savedTemplates.invalidate();
      setSelectedTemplateIds((current) => [...new Set([...current, saved.id])]);
      setUiError(null);
      toastManager.add({ type: "success", title: `${saved.title} created.` });
    },
    onError: (error) => {
      setUiError(error.message);
      toastManager.add({ type: "error", title: error.message });
    },
  });

  const createTemplate = trpc.outreach.createTemplate.useMutation({
    onSuccess: async (saved) => {
      await utils.outreach.savedTemplates.invalidate();
      toastManager.add({ type: "success", title: `${saved.title} created.` });
    },
    onError: (error) => { toastManager.add({ type: "error", title: error.message }); },
  });

  const updateTemplate = trpc.outreach.updateTemplate.useMutation({
    onSuccess: async () => { await utils.outreach.savedTemplates.invalidate(); },
    onError: (error) => { toastManager.add({ type: "error", title: error.message }); },
  });

  const deleteTemplate = trpc.outreach.deleteTemplate.useMutation({
    onSuccess: async () => {
      await utils.outreach.savedTemplates.invalidate();
      toastManager.add({ type: "success", title: "Template deleted." });
    },
    onError: (error) => { toastManager.add({ type: "error", title: error.message }); },
  });

  const leads = listQuery.data ?? [];
  const allSavedTemplates = savedTemplatesQuery.data ?? [];
  const forkedSourceIds = new Set(allSavedTemplates.map((t) => t.sourceId).filter(Boolean));
  const standardTemplates = (templatesQuery.data ?? []).filter((t) => !forkedSourceIds.has(t.id));
  const generatedTemplates = allSavedTemplates;
  const templates = [...standardTemplates, ...generatedTemplates];

  const selectedLeads = useMemo(
    () => leads.filter((lead) => selectedLeadIds.includes(lead.id)),
    [leads, selectedLeadIds],
  );
  const selectedTemplates = useMemo(
    () => templates.filter((t) => selectedTemplateIds.includes(t.id)),
    [templates, selectedTemplateIds],
  );

  function toggleLead(leadId: string, checked: boolean) {
    setSelectedLeadIds((current) =>
      checked ? [...new Set([...current, leadId])] : current.filter((id) => id !== leadId),
    );
  }

  function toggleProject(projectId: string) {
    hasUserToggledProjects.current = true;
    setSelectedProjectIds((current) =>
      current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId],
    );
  }

  function toggleTemplate(templateId: string) {
    setSelectedTemplateIds((current) =>
      current.includes(templateId)
        ? current.filter((id) => id !== templateId)
        : [...current, templateId],
    );
  }

  async function handleImportFolder() {
    if (!effectiveImportProjectId) { toastManager.add({ type: "error", title: "Select a folder to import." }); return; }
    setUiError(null);
    await queueAllLeads.mutateAsync({ projectId: effectiveImportProjectId });
  }

  async function handleGenerateTemplate() {
    if (effectiveProjectIds.length === 0) {
      toastManager.add({ type: "error", title: "Select at least one campaign to give AI context." });
      return;
    }
    await generateTemplate.mutateAsync({
      projectIds: effectiveProjectIds,
      requestedStyle: stylePrompt.trim() || undefined,
    });
  }

  async function handleRemoveSelected() {
    if (selectedLeadIds.length === 0) {
      toastManager.add({ type: "info", title: "Select at least one lead." });
      return;
    }
    await bulkUpdateLeads.mutateAsync({
      crmIds: selectedLeadIds,
      patch: toPatchInput({ inOutreach: false }),
    });
    toastManager.add({ type: "success", title: `Removed ${selectedLeadIds.length} leads from queue.` });
    setSelectedLeadIds([]);
  }

  function handleCreateTemplate({ title, body, sourceId }: { title: string; body: string; sourceId?: string }) {
    createTemplate.mutate({ title, body, subject: title, replyRate: "—", sourceId });
  }

  function handleUpdateTemplate(id: string, { title, body }: { title: string; body: string }) {
    updateTemplate.mutate({ id, title, body, subject: title, replyRate: "—" });
  }

  const sendDms = trpc.outreach.sendDms.useMutation({
    onSuccess: async (result) => {
      await Promise.all([
        utils.outreach.list.invalidate(),
        utils.leads.list.invalidate(),
      ]);
      if (result.sent > 0 && result.failed === 0) {
        toastManager.add({ type: "success", title: `Sent ${result.sent} DMs successfully.` });
      } else if (result.sent > 0) {
        toastManager.add({ type: "warning", title: `Sent ${result.sent} DMs. ${result.failed} failed.${result.rateLimited > 0 ? ` ${result.rateLimited} queued (rate limited).` : ""}` });
      } else {
        toastManager.add({ type: "error", title: `All ${result.failed} DMs failed.${result.results[0]?.error ? ` ${result.results[0].error}` : ""}` });
      }
    },
    onError: (error) => {
      setUiError(error.message);
      toastManager.add({ type: "error", title: error.message });
    },
  });

  const xAccountQuery = trpc.outreach.hasXAccount.useQuery();

  async function handleSendSelected() {
    if (selectedLeads.length === 0) {
      toastManager.add({ type: "info", title: "Select at least one lead." });
      return;
    }
    if (selectedTemplates.length === 0) {
      toastManager.add({ type: "info", title: "Select at least one template." });
      return;
    }

    // Check if X account is connected
    if (!xAccountQuery.data?.connected) {
      toastManager.add({ type: "error", title: "Connect your X account in Settings to send DMs." });
      return;
    }

    // Build DM payloads — check each lead has an xUserId
    const dmLeads: Array<{ leadId: string; xUserId: string; message: string }> = [];
    const skippedNoId: string[] = [];

    for (const [index, lead] of selectedLeads.entries()) {
      const template = selectedTemplates[index % selectedTemplates.length];
      const message = applyTemplate(template, lead);

      if (lead.xUserId) {
        dmLeads.push({ leadId: lead.id, xUserId: lead.xUserId, message });
      } else {
        skippedNoId.push(lead.name);
      }
    }

    if (skippedNoId.length > 0) {
      toastManager.add({
        type: "warning",
        title: `${skippedNoId.length} lead(s) have no X user ID and will be skipped: ${skippedNoId.slice(0, 3).join(", ")}${skippedNoId.length > 3 ? "..." : ""}`,
      });
    }

    if (dmLeads.length === 0) {
      toastManager.add({ type: "error", title: "No leads with X user IDs to send DMs to." });
      return;
    }

    // Send DMs via X API — the backend handles rate limiting, stage updates, etc.
    await sendDms.mutateAsync({ leads: dmLeads });
    setSelectedLeadIds([]);
  }

  return {
    // data
    leads,
    projects,
    standardTemplates,
    generatedTemplates,
    // selection state
    selectedLeadIds,
    setSelectedLeadIds,
    selectedTemplateIds,
    selectedProjectIds: effectiveProjectIds,
    selectedLeads,
    selectedTemplates,
    // ui state
    stylePrompt,
    setStylePrompt,
    importProjectId: effectiveImportProjectId,
    setImportProjectId,
    uiError,
    // pending
    isSending: sendDms.isPending || updateLead.isPending,
    isRemoving: bulkUpdateLeads.isPending,
    isGenerating: generateTemplate.isPending,
    hasXAccount: xAccountQuery.data?.connected ?? false,
    // handlers
    toggleLead,
    toggleProject,
    toggleTemplate,
    handleImportFolder,
    handleGenerateTemplate,
    handleCreateTemplate,
    handleUpdateTemplate,
    handleRemoveSelected,
    handleSendSelected,
    handleDeleteTemplate: (id: string) => deleteTemplate.mutate({ id }),
  };
}
