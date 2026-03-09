"use client";

import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import { CheckCircle2Icon, ChevronDownIcon, PencilIcon, PlusIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toastManager } from "@/components/ui/toast";
import { trpc } from "@/lib/trpc/client";
import type { Lead, OutreachTemplate } from "@/lib/types";

const STORAGE_KEY = "skaleai-generated-outreach-templates";

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

function applyTemplate(template: OutreachTemplate, lead: Lead): string {
  return `${template.subject}\n\n${template.body
    .replaceAll("{{name}}", lead.name)
    .replaceAll("{{platform}}", "X")
    .replaceAll("{{company}}", "")}`;
}

export function OutreachWorkspace() {
  const utils = trpc.useUtils();
  const listQuery = trpc.outreach.list.useQuery();
  const templatesQuery = trpc.outreach.templates.useQuery();
  const { data: projects = [] } = trpc.projects.list.useQuery();

  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>(["standard-1"]);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [generatedTemplates, setGeneratedTemplates] = useState<OutreachTemplate[]>([]);
  const [stylePrompt, setStylePrompt] = useState("");
  const [importProjectId, setImportProjectId] = useState("");
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        setGeneratedTemplates(JSON.parse(raw) as OutreachTemplate[]);
      }
    } catch {
      setGeneratedTemplates([]);
    }
  }, []);

  useEffect(() => {
    if (projects.length > 0 && selectedProjectIds.length === 0) {
      setSelectedProjectIds(projects.map((project) => project.id));
      setImportProjectId((current) => current || projects[0]?.id || "");
    }
  }, [projects, selectedProjectIds.length]);

  useEffect(() => {
    if (generatedTemplates.length > 0) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(generatedTemplates));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, [generatedTemplates]);

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
      toastManager.add({
        type: "success",
        title: `Imported ${result.queued} leads from folder.`,
      });
    },
    onError: (error) => {
      setUiError(error.message);
      toastManager.add({ type: "error", title: error.message });
    },
  });

  const generateTemplate = trpc.outreach.generateTemplate.useMutation({
    onSuccess: (template) => {
      const newTemplate: OutreachTemplate = {
        ...template,
        id: `generated-${Date.now()}`,
        generated: true,
      };
      setGeneratedTemplates((current) => [...current, newTemplate]);
      setSelectedTemplateIds((current) => [...new Set([...current, newTemplate.id])]);
      setUiError(null);
      toastManager.add({
        type: "success",
        title: `${newTemplate.title} created.`,
      });
    },
    onError: (error) => {
      setUiError(error.message);
      toastManager.add({ type: "error", title: error.message });
    },
  });

  const leads = listQuery.data ?? [];
  const standardTemplates = templatesQuery.data ?? [];
  const templates = [...standardTemplates, ...generatedTemplates];
  const selectedLeads = useMemo(
    () => leads.filter((lead) => selectedLeadIds.includes(lead.id)),
    [leads, selectedLeadIds],
  );
  const selectedTemplates = useMemo(
    () => templates.filter((template) => selectedTemplateIds.includes(template.id)),
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
    if (!importProjectId) {
      setUiError("Select a folder to import.");
      return;
    }

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

    toastManager.add({
      type: "success",
      title: `Removed ${selectedLeadIds.length} leads from queue.`,
    });
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
        patch: toPatchInput({
          stage: "messaged",
          inOutreach: true,
          theAsk: applyTemplate(template, lead),
        }),
      });
    }

    toastManager.add({
      type: "success",
      title: `Applied ${selectedTemplates.length} templates across ${selectedLeads.length} leads.`,
    });
    setSelectedLeadIds([]);
  }

  return (
    <div className="mx-auto max-w-[1700px] px-8 py-8">
      <div className="mb-8 flex flex-col gap-5 border-b border-border/70 pb-6 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="text-[0.95rem] text-muted-foreground">Campaign</div>
          <h1 className="mt-1 text-[2.9rem] font-semibold tracking-[-0.04em]">Outreach</h1>
        </div>

        <div />
      </div>

      {showAiPanel ? (
        <div className="mb-8 rounded-[1.2rem] border border-border/70 bg-card px-5 py-4">
          <div className="mb-3 text-[0.95rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            AI context
          </div>
          <div className="mb-4 flex flex-wrap gap-2">
            {projects.map((project) => {
              const selected = selectedProjectIds.includes(project.id);
              return (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => toggleProject(project.id)}
                  className={`rounded-full border px-3 py-1.5 text-[0.85rem] transition-colors ${
                    selected
                      ? "border-foreground/20 bg-foreground text-background"
                      : "border-border bg-background text-muted-foreground"
                  }`}
                >
                  {project.name}
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="max-w-[860px] text-[0.92rem] text-muted-foreground">
              AI uses only the selected folders to tailor a concise outreach template. It is prompted with the 4 standard examples so generated templates stay close in size and structure.
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Input
                className="h-10 w-[280px] rounded-xl text-[0.92rem]"
                placeholder="Optional angle, e.g. more premium / more direct"
                value={stylePrompt}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setStylePrompt(event.target.value)}
              />
              <Button
                className="h-10 rounded-xl px-4 text-[0.92rem]"
                disabled={generateTemplate.isPending}
                onClick={() => {
                  handleGenerateTemplate().catch(() => undefined);
                }}
              >
                {generateTemplate.isPending ? <SparklesIcon className="size-4 animate-pulse" /> : <PlusIcon className="size-4" />}
                Create new
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {uiError ? (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[0.95rem] text-red-700">
          {uiError}
        </div>
      ) : null}

      <div className="mb-8">
        <div className="mb-1 text-[1rem] font-semibold">Choose a template to outreach</div>
        <div className="mb-5 text-[0.95rem] text-muted-foreground">
          You can select multiple templates to randomise the outreach.
        </div>

        <div className="grid items-stretch gap-5 xl:grid-cols-4">
          {standardTemplates.map((template) => {
            const selected = selectedTemplateIds.includes(template.id);

            return (
              <button
                key={template.id}
                type="button"
                onClick={() => toggleTemplate(template.id)}
                className={`grid min-h-[520px] grid-rows-[72px_auto_1fr_88px] rounded-[1.2rem] border bg-card p-6 text-left shadow-sm transition-colors ${
                  selected ? "border-red-400" : "border-border/70 hover:border-foreground/20"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="text-[1rem] font-semibold">{template.title}</div>
                  {selected ? (
                    <CheckCircle2Icon className="size-5 text-red-500" />
                  ) : (
                    <PencilIcon className="size-4 text-muted-foreground" />
                  )}
                </div>

                <div className="h-px bg-border/70" />

                <div className="self-start whitespace-pre-line text-[0.98rem] leading-8 text-muted-foreground">
                  {template.body}
                </div>

                <div className="grid h-full grid-cols-[minmax(0,1fr)_auto] items-end gap-4 border-t border-border/70 pt-4 text-[0.95rem]">
                  <span className="line-clamp-2 min-h-[3rem] text-muted-foreground">{template.subject}</span>
                  <span className="whitespace-nowrap font-medium">Reply rate {template.replyRate}</span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-5">
          <Button
            variant="outline"
            className="h-10 rounded-xl px-4 text-[0.92rem]"
            onClick={() => setShowAiPanel((current) => !current)}
          >
            AI analysis
            <ChevronDownIcon className={`size-4 transition-transform ${showAiPanel ? "rotate-180" : ""}`} />
          </Button>
        </div>

        {generatedTemplates.length > 0 ? (
          <div className="mt-8">
            <div className="mb-4 text-[0.92rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Generated templates
            </div>
            <div className="grid items-stretch gap-5 xl:grid-cols-4">
              {generatedTemplates.map((template) => {
                const selected = selectedTemplateIds.includes(template.id);

                return (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => toggleTemplate(template.id)}
                    className={`grid min-h-[520px] grid-rows-[72px_auto_1fr_88px] rounded-[1.2rem] border bg-card p-6 text-left shadow-sm transition-colors ${
                      selected ? "border-red-400" : "border-border/70 hover:border-foreground/20"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-[1rem] font-semibold">{template.title}</div>
                      {selected ? (
                        <CheckCircle2Icon className="size-5 text-red-500" />
                      ) : (
                        <PencilIcon className="size-4 text-muted-foreground" />
                      )}
                    </div>

                    <div className="h-px bg-border/70" />

                    <div className="self-start whitespace-pre-line text-[0.98rem] leading-8 text-muted-foreground">
                      {template.body}
                    </div>

                    <div className="grid h-full grid-cols-[minmax(0,1fr)_auto] items-end gap-4 border-t border-border/70 pt-4 text-[0.95rem]">
                      <span className="line-clamp-2 min-h-[3rem] text-muted-foreground">{template.subject}</span>
                      <span className="whitespace-nowrap font-medium">Reply rate {template.replyRate}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      <div className="mb-8">
        <div className="mb-3 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="text-[0.95rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Leads in queue
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <select
              className="h-10 min-w-[220px] rounded-xl border border-input bg-background px-3 text-[0.92rem]"
              value={importProjectId}
              onChange={(event) => setImportProjectId(event.target.value)}
            >
              <option value="">Select folder</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              className="h-10 rounded-xl px-4 text-[0.92rem]"
              onClick={() => {
                handleImportFolder().catch(() => undefined);
              }}
            >
              Import folder
            </Button>
            <Button
              variant="outline"
              className="h-10 rounded-xl px-4 text-[0.92rem]"
              disabled={selectedLeadIds.length === 0 || bulkUpdateLeads.isPending}
              onClick={() => {
                handleRemoveSelected().catch(() => undefined);
              }}
            >
              <Trash2Icon className="size-4" />
              Remove selected
            </Button>
          </div>
        </div>
        <div className="overflow-hidden rounded-[1.2rem] border border-border/70 bg-background">
          <Table className="text-[0.92rem]">
            <TableHeader className="bg-muted/10 [&_tr]:border-b [&_tr]:border-border/60">
              <TableRow className="h-11 hover:bg-transparent">
                <TableHead className="w-[44px] px-3 text-center">
                  <Checkbox
                    checked={leads.length > 0 && leads.every((lead) => selectedLeadIds.includes(lead.id))}
                    onCheckedChange={(value) => setSelectedLeadIds(Boolean(value) ? leads.map((lead) => lead.id) : [])}
                  />
                </TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="text-center">Email</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-center">Followers</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.length === 0 ? (
                <TableRow className="h-[130px] hover:bg-transparent">
                  <TableCell colSpan={5} className="text-center text-[0.98rem] text-muted-foreground">
                    No leads in queue. Import a folder from your projects.
                  </TableCell>
                </TableRow>
              ) : (
                leads.map((lead) => (
                  <TableRow key={lead.id} className="h-[58px] border-b border-border/50 hover:bg-muted/5">
                    <TableCell className="px-3 text-center">
                      <Checkbox
                        checked={selectedLeadIds.includes(lead.id)}
                        onCheckedChange={(value) => toggleLead(lead.id, Boolean(value))}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{lead.name}</div>
                      <div className="text-[0.85rem] text-muted-foreground">@{lead.handle}</div>
                    </TableCell>
                    <TableCell className="text-center text-muted-foreground">{lead.email ?? "—"}</TableCell>
                    <TableCell className="text-center">{statusLabel(lead.stage)}</TableCell>
                    <TableCell className="text-center font-medium">
                      {lead.followers >= 1000 ? `${(lead.followers / 1000).toFixed(1)}k` : lead.followers}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-border/70 pt-6">
        <div className="text-[0.95rem] text-muted-foreground">
          {selectedTemplateIds.length} templates selected • {selectedLeadIds.length} leads selected
        </div>
        <Button
          className="h-11 rounded-xl px-5 text-[0.95rem]"
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
  );
}
