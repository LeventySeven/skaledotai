"use client";

import { useState } from "react";
import { XIcon } from "lucide-react";

interface TemplateModalProps {
  mode: "create" | "edit";
  initialTitle?: string;
  initialBody?: string;
  onClose: () => void;
  onSave: (values: { title: string; body: string }) => void;
}

export function TemplateModal({ mode, initialTitle = "", initialBody = "", onClose, onSave }: TemplateModalProps) {
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl border border-border/70 bg-background p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-[18px] font-medium">{mode === "create" ? "New template" : "Edit template"}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:text-foreground">
            <XIcon className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[0.85rem] font-medium text-muted-foreground">Title</label>
            <input
              autoFocus
              className="h-10 rounded-xl border border-input bg-background px-3 text-[0.95rem] outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 focus:ring-offset-background"
              placeholder="e.g. Warm intro"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[0.85rem] font-medium text-muted-foreground">Body</label>
            <textarea
              className="min-h-[160px] resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-[0.95rem] leading-relaxed outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 focus:ring-offset-background"
              placeholder={"Hi {{name}},\n\n..."}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-xl border border-input px-4 text-[0.9rem] text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!title.trim()}
            onClick={() => { onSave({ title, body }); onClose(); }}
            className="h-9 rounded-xl bg-foreground px-4 text-[0.9rem] text-background hover:opacity-90 disabled:opacity-40"
          >
            {mode === "create" ? "Create" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
