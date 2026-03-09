"use client";

import { type ChangeEvent } from "react";
import { PlusIcon, SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Project } from "@/lib/validations/projects";

interface AiPanelProps {
  projects: Project[];
  selectedProjectIds: string[];
  onToggleProject: (id: string) => void;
  stylePrompt: string;
  onStylePromptChange: (value: string) => void;
  isGenerating: boolean;
  onGenerate: () => void;
}

export function AiPanel({
  projects,
  selectedProjectIds,
  onToggleProject,
  stylePrompt,
  onStylePromptChange,
  isGenerating,
  onGenerate,
}: AiPanelProps) {
  return (
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
              onClick={() => onToggleProject(project.id)}
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
          AI uses only the selected folders to tailor a concise outreach template. It is prompted
          with the 4 standard examples so generated templates stay close in size and structure.
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Input
            className="h-10 w-[280px] rounded-xl text-[0.92rem]"
            placeholder="Optional angle, e.g. more premium / more direct"
            value={stylePrompt}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onStylePromptChange(e.target.value)}
          />
          <Button
            className="h-10 rounded-xl px-4 text-[0.92rem]"
            disabled={isGenerating}
            onClick={onGenerate}
          >
            {isGenerating
              ? <SparklesIcon className="size-4 animate-pulse" />
              : <PlusIcon className="size-4" />}
            Create new
          </Button>
        </div>
      </div>
    </div>
  );
}
