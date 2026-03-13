"use client";

import { CheckCircle2Icon, Trash2Icon } from "lucide-react";

function EditIcon({ className }: { className?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className={className}>
      <g opacity="0.4">
        <path d="M3.62553 11.4156L3 15L6.58462 14.3743C6.85495 14.3272 7.10414 14.1977 7.29818 14.0037L14.7071 6.59467C15.0976 6.20414 15.0976 5.57096 14.707 5.18044L12.8194 3.29288C12.4289 2.90237 11.7958 2.90237 11.4052 3.29289L3.99621 10.7021C3.80216 10.8961 3.67271 11.1453 3.62553 11.4156Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M10.5 4.5L13.5 7.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/>
      </g>
    </svg>
  );
}
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
        className={`flex h-[335px] w-full flex-col gap-3 rounded-[10px] border bg-card p-4 text-left shadow-sm transition-colors ${
          selected ? "border-red-400" : "border-border/70 hover:border-foreground/20"
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="text-[0.95rem] font-semibold">{template.title}</div>
          {selected ? (
            <CheckCircle2Icon className="size-4 shrink-0 text-red-500" />
          ) : (
            <EditIcon className="shrink-0 text-foreground" />
          )}
        </div>

        <div className="h-px bg-border/70" />

        <div className="min-h-0 flex-1 overflow-hidden text-[0.85rem] leading-[1.6] text-muted-foreground">
          <p className="whitespace-pre-line">{template.body}</p>
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
