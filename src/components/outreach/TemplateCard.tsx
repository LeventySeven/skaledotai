"use client";

import { CheckCircle2Icon, PencilIcon, Trash2Icon } from "lucide-react";
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
        className={`grid min-h-[520px] w-full grid-rows-[72px_auto_1fr_88px] rounded-[1.2rem] border bg-card p-6 text-left shadow-sm transition-colors ${
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
          <span className="line-clamp-2 min-h-12 text-muted-foreground">{template.subject}</span>
          <span className="whitespace-nowrap font-medium">Reply rate {template.replyRate}</span>
        </div>
      </button>

      {onDelete ? (
        <button
          type="button"
          onClick={onDelete}
          className="absolute right-3 top-3 rounded-lg p-1 text-muted-foreground hover:text-destructive"
        >
          <Trash2Icon className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
