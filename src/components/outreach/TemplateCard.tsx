"use client";

import { CheckCircle2Icon, Trash2Icon } from "lucide-react";
import type { OutreachTemplate } from "@/lib/validations/outreach";

interface TemplateCardProps {
  template: OutreachTemplate;
  selected: boolean;
  onToggle: () => void;
  onDelete?: () => void;
}

export function TemplateCard({ template, selected, onToggle, onDelete }: TemplateCardProps) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className={`flex h-[245px] w-full flex-col gap-3 rounded-[10px] border bg-card p-4 text-left shadow-sm transition-colors ${
          selected ? "border-red-400" : "border-border/70 hover:border-foreground/20"
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="text-[0.95rem] font-semibold">{template.title}</div>
          {selected ? (
            <CheckCircle2Icon className="size-4 shrink-0 text-red-500" />
          ) : null}
        </div>

        <div className="h-px bg-border/70" />

        <div className="min-h-0 flex-1 overflow-hidden text-[0.85rem] leading-[1.6] text-muted-foreground">
          <p className="line-clamp-5 whitespace-pre-line">{template.body}</p>
        </div>

        <div className="flex items-center justify-between border-t border-border/70 pt-3 text-[0.82rem]">
          <span className="truncate text-muted-foreground">{template.subject}</span>
          <span className="shrink-0 font-medium">{template.replyRate}</span>
        </div>
      </button>

      {onDelete ? (
        <button
          type="button"
          onClick={onDelete}
          className="absolute right-2 top-2 rounded-lg p-1 text-muted-foreground hover:text-destructive"
        >
          <Trash2Icon className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
