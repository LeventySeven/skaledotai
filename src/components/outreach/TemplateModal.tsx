"use client";

import { useState } from "react";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toastManager } from "@/components/ui/toast";

interface TemplateModalProps {
  mode: "create" | "edit" | "fork";
  initialTitle?: string;
  initialBody?: string;
  onClose: () => void;
  onSave: (values: { title: string; body: string }) => void;
}

const TITLE_MIN = 3;
const BODY_MIN = 10;

export function TemplateModal({ mode, initialTitle = "", initialBody = "", onClose, onSave }: TemplateModalProps) {
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);

  function handleSave() {
    if (title.trim().length < TITLE_MIN) {
      toastManager.add({ type: "error", title: `Title must be at least ${TITLE_MIN} characters.` });
      return;
    }
    if (body.trim().length < BODY_MIN) {
      toastManager.add({ type: "error", title: `Body must be at least ${BODY_MIN} characters.` });
      return;
    }
    onSave({ title: title.trim(), body: body.trim() });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl border border-border/70 bg-background p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-[18px] font-medium">
            {mode === "create" ? "New template" : mode === "fork" ? "Save as your template" : "Edit template"}
          </h2>
          <Button variant="ghost" size="icon-bare" onClick={onClose}>
            <XIcon className="size-4" />
          </Button>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[0.85rem] font-medium text-muted-foreground">Title</label>
              <span className={`text-[0.78rem] ${title.trim().length < TITLE_MIN ? "text-muted-foreground/50" : "text-muted-foreground"}`}>
                {title.trim().length}/{TITLE_MIN} min
              </span>
            </div>
            <input
              autoFocus
              className="h-10 rounded-xl border border-input bg-background px-3 text-[0.95rem] outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 focus:ring-offset-background"
              placeholder="e.g. Warm intro"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[0.85rem] font-medium text-muted-foreground">Body</label>
              <span className={`text-[0.78rem] ${body.trim().length < BODY_MIN ? "text-muted-foreground/50" : "text-muted-foreground"}`}>
                {body.trim().length}/{BODY_MIN} min
              </span>
            </div>
            <textarea
              className="min-h-[160px] resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-[0.95rem] leading-relaxed outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 focus:ring-offset-background"
              placeholder={"Hi {{name}},\n\n..."}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="outline"
            className="h-9 rounded-xl px-4 text-[0.9rem]"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            className="h-9 rounded-xl px-4 text-[0.9rem]"
            onClick={handleSave}
          >
            {mode === "create" ? "Create" : mode === "fork" ? "Save to my templates" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
