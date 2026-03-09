"use client";

import { useEffect, useMemo, useState } from "react";
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

export function useOutreachWorkspace() {
  const utils = trpc.useUtils();
  const listQuery = trpc.outreach.list.useQuery();
  const templatesQuery = trpc.outreach.templates.useQuery();
  const savedTemplatesQuery = trpc.outreach.savedTemplates.useQuery();
  const { data: projects = [] } = trpc.projects.list.useQuery();

  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>(["standard-1"]);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [stylePrompt, setStylePrompt] = useState("");
  const [importProjectId, setImportProjectId] = useState("");
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);

  useEffect(() => {
    if (projects.length > 0 && selectedProjectIds.length === 0) {
      setSelectedProjectIds(projects.map((p) => p.id));
      setImportProjectId((current) => current || projects[0]?.id || "");
    }
  }, [projects, selectedProjectIds.length]);

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

  const deleteTemplate = trpc.outreach.deleteTemplate.useMutation({
    onSuccess: async () => { await utils.outreach.savedTemplates.invalidate(); },
    onError: (error) => { toastManager.add({ type: "error", title: error.message }); },
  });

  const leads = listQuery.data ?? [];
  const standardTemplates = templatesQuery.data ?? [];
  const generatedTemplates = savedTemplatesQuery.data ?? [];
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
    if (!importProjectId) { setUiError("Select a folder to import."); return; }
    setUiError(null);
    await queueAllLeads.mutateAsync({ projectId: importProjectId });
  }

  async function handleGenerateTemplate() {
    setUiError(null);
    await generateTemplate.mutateAsync({
      projectIds: selectedProjectIds,
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

  async function handleSendSelected() {
    if (selectedLeads.length === 0) {
      toastManager.add({ type: "info", title: "Select at least one lead." });
      return;
    }
    if (selectedTemplates.length === 0) {
      toastManager.add({ type: "info", title: "Select at least one template." });
      return;
    }
    for (const [index, lead] of selectedLeads.entries()) {
      const template = selectedTemplates[index % selectedTemplates.length];
      await updateLead.mutateAsync({
        crmId: lead.id,
        patch: toPatchInput({ stage: "messaged", inOutreach: true, theAsk: applyTemplate(template, lead) }),
      });
    }
    toastManager.add({ type: "success", title: `Applied ${selectedTemplates.length} templates across ${selectedLeads.length} leads.` });
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
    selectedProjectIds,
    selectedLeads,
    selectedTemplates,
    // ui state
    stylePrompt,
    setStylePrompt,
    importProjectId,
    setImportProjectId,
    showAiPanel,
    setShowAiPanel,
    uiError,
    // pending
    isSending: updateLead.isPending,
    isRemoving: bulkUpdateLeads.isPending,
    isGenerating: generateTemplate.isPending,
    // handlers
    toggleLead,
    toggleProject,
    toggleTemplate,
    handleImportFolder,
    handleGenerateTemplate,
    handleRemoveSelected,
    handleSendSelected,
    handleDeleteTemplate: (id: string) => deleteTemplate.mutate({ id }),
  };
}
