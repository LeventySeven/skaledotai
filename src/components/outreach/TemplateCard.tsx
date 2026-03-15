"use client";

import { useState } from "react";
import { CheckCircle2Icon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OutreachTemplate } from "@/lib/validations/outreach";
import { TemplateModal } from "./TemplateModal";

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

interface TemplateCardProps {
  template: OutreachTemplate;
  selected: boolean;
  onToggle: () => void;
  onSave?: (updated: Pick<OutreachTemplate, "title" | "body">) => void;
  onDelete?: () => void;
  fork?: boolean;
}

export function TemplateCard({ template, selected, onToggle, onSave, onDelete, fork }: TemplateCardProps) {
  const [editOpen, setEditOpen] = useState(false);

  return (
    <>
      <div className="relative">
        <div
          role="button"
          tabIndex={0}
          onClick={onToggle}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onToggle(); }}
          className={`flex h-[335px] w-full cursor-pointer flex-col gap-3 rounded-[10px] border bg-card p-4 text-left shadow-sm transition-colors ${
            selected ? "border-[#e43420]" : "border-border/70 hover:border-foreground/20"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="text-[0.95rem] font-semibold">{template.title}</div>
            {selected ? (
              <span className="flex size-[26px] shrink-0 items-center justify-center">
                <CheckCircle2Icon className="size-[18px] text-[#e43420]" />
              </span>
            ) : (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={(e) => { e.stopPropagation(); setEditOpen(true); }}
              >
                <EditIcon className="text-foreground" />
              </Button>
            )}
          </div>

          <div className="h-px bg-border/70" />

          <div className="min-h-0 flex-1 overflow-hidden text-[0.85rem] leading-[1.6] text-muted-foreground">
            <p className="whitespace-pre-line">{template.body}</p>
          </div>

          <div className="flex items-center justify-between border-t border-border/70 pt-3 text-[0.82rem]">
            {onDelete ? (
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground/50 hover:bg-red-50 hover:text-red-500"
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            ) : <span />}
            <span className="font-medium">Reply rate {template.replyRate}</span>
          </div>
        </div>
      </div>

      {editOpen ? (
        <TemplateModal
          mode={fork ? "fork" : "edit"}
          initialTitle={template.title}
          initialBody={template.body}
          onClose={() => setEditOpen(false)}
          onSave={(updated) => onSave?.(updated)}
        />
      ) : null}
    </>
  );
}
