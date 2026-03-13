"use client";

import { useState } from "react";
import { ChevronDownIcon, Trash2Icon } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AiPanel } from "./AiPanel";
import { TemplateCard } from "./TemplateCard";
import { TemplateModal } from "./TemplateModal";
import { useOutreachWorkspace } from "./useOutreachWorkspace";

function statusLabel(stage: string): string {
  if (stage === "agreed") return "Agreed";
  if (stage === "replied") return "Replied";
  if (stage === "messaged") return "Messaged";
  return "Queued";
}

interface OutreachWorkspaceProps {
  initialStandardTemplates?: import("@/lib/validations/outreach").OutreachTemplate[];
  initialSavedTemplates?: import("@/lib/validations/outreach").OutreachTemplate[];
}

export function OutreachWorkspace({ initialStandardTemplates, initialSavedTemplates }: OutreachWorkspaceProps) {
  const {
    leads,
    projects,
    standardTemplates,
    generatedTemplates,
    selectedLeadIds,
    setSelectedLeadIds,
    selectedTemplateIds,
    selectedProjectIds,
    stylePrompt,
    setStylePrompt,
    importProjectId,
    setImportProjectId,
    showAiPanel,
    setShowAiPanel,
    uiError,
    isSending,
    isRemoving,
    isGenerating,
    toggleLead,
    toggleProject,
    toggleTemplate,
    handleImportFolder,
    handleGenerateTemplate,
    handleCreateTemplate,
    handleRemoveSelected,
    handleSendSelected,
    handleDeleteTemplate,
  } = useOutreachWorkspace({ initialStandardTemplates, initialSavedTemplates });

  const [createModalOpen, setCreateModalOpen] = useState(false);

  return (
    <div className="mx-auto max-w-[1700px] px-8 py-8">
      <div className="flex w-full items-start justify-between pb-6">
        <div className="flex flex-col">
          <div className="text-[18px] font-medium text-[#111111]/40">Campaign</div>
          <h1 className="text-[28px] font-medium tracking-[-0.04em]">Outreach</h1>
        </div>
        <div />
      </div>
      <div className="-mx-8 mb-5 border-b border-border/70" />

      {uiError ? (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[0.95rem] text-red-700">
          {uiError}
        </div>
      ) : null}

      <div className="mb-8">
        <div className="mb-5 flex items-end justify-between">
          <div className="w-fit">
            <div className="mb-1 text-[18px] font-medium text-[#111111]">Choose a template to outreach</div>
            <div className="text-[16px] font-normal text-muted-foreground">
              You can select multiple templates to randomise the outreach.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCreateModalOpen(true)}
            className="flex h-8 min-w-8 items-center gap-0.5 rounded-[10px] border border-[#00000014] bg-[#00000009] px-1.5 text-[0.88rem] font-medium whitespace-nowrap"
          >
            <span className="px-1">Create new</span>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="shrink-0">
              <path d="M9 3.75V14.25M3.75 9H14.25" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(271px,1fr))] items-stretch gap-5">
          {standardTemplates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              selected={selectedTemplateIds.includes(template.id)}
              onToggle={() => toggleTemplate(template.id)}
            />
          ))}
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

        {showAiPanel ? (
          <div className="mt-4">
            <AiPanel
              projects={projects}
              selectedProjectIds={selectedProjectIds}
              onToggleProject={toggleProject}
              stylePrompt={stylePrompt}
              onStylePromptChange={setStylePrompt}
              isGenerating={isGenerating}
              onGenerate={() => { handleGenerateTemplate().catch(() => undefined); }}
            />
          </div>
        ) : null}

        {generatedTemplates.length > 0 ? (
          <div className="mt-8">
            <div className="mb-4 text-[0.92rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Generated templates
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(271px,1fr))] items-stretch gap-5">
              {generatedTemplates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  selected={selectedTemplateIds.includes(template.id)}
                  onToggle={() => toggleTemplate(template.id)}
                  onDelete={() => handleDeleteTemplate(template.id)}
                />
              ))}
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
              onChange={(e) => setImportProjectId(e.target.value)}
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
              onClick={() => { handleImportFolder().catch(() => undefined); }}
            >
              Import folder
            </Button>
            <Button
              variant="outline"
              className="h-10 rounded-xl px-4 text-[0.92rem]"
              disabled={selectedLeadIds.length === 0 || isRemoving}
              onClick={() => { handleRemoveSelected().catch(() => undefined); }}
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
                    onCheckedChange={(value) =>
                      setSelectedLeadIds(Boolean(value) ? leads.map((lead) => lead.id) : [])
                    }
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
          disabled={isSending}
          onClick={() => {
            handleSendSelected().catch((error: unknown) => {
              console.error("Failed to send outreach:", error);
            });
          }}
        >
          Send to Selected
        </Button>
      </div>

      {createModalOpen ? (
        <TemplateModal
          mode="create"
          onClose={() => setCreateModalOpen(false)}
          onSave={handleCreateTemplate}
        />
      ) : null}
    </div>
  );
}
