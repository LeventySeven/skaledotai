"use client";

import { type ChangeEvent } from "react";
import { SparklesIcon } from "lucide-react";
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
    <div className="rounded-[10px] border border-dashed border-border bg-muted/20 p-5">
      <div className="mb-4 flex items-center gap-2">
        <SparklesIcon className="size-4 text-muted-foreground" />
        <span className="text-[0.95rem] font-medium">Generate with AI</span>
        <span className="text-[0.85rem] text-muted-foreground">— select folders so AI knows who you're reaching out to</span>
      </div>

      {projects.length > 0 ? (
        <div className="mb-4 flex flex-wrap gap-2">
          {projects.map((project) => {
            const selected = selectedProjectIds.includes(project.id);
            return (
              <span
                key={project.id}
                role="checkbox"
                aria-checked={selected}
                tabIndex={0}
                onClick={() => onToggleProject(project.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggleProject(project.id); } }}
                className={`inline-block cursor-pointer rounded-[8px] border px-2.5 py-1 text-[0.78rem] leading-tight transition-colors ${
                  selected
                    ? "border-border bg-card text-foreground shadow-xs"
                    : "border-transparent text-muted-foreground hover:border-border hover:bg-card"
                }`}
              >
                {project.name}
              </span>
            );
          })}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Input
          className="h-8 w-[280px] rounded-[10px] text-[0.88rem]"
          placeholder="e.g. more casual, friendly, or direct"
          value={stylePrompt}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onStylePromptChange(e.target.value)}
        />
        <Button
          className="h-8 rounded-[10px] px-4 text-[0.88rem]"
          disabled={isGenerating}
          onClick={onGenerate}
        >
          {isGenerating ? <SparklesIcon className="size-3.5 animate-pulse" /> : <SparklesIcon className="size-3.5" />}
          {isGenerating ? "Generating…" : "Generate template"}
        </Button>
      </div>
    </div>
  );
}
