"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "New template" : mode === "fork" ? "Save as your template" : "Edit template"}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Create a new outreach template."
              : mode === "fork"
                ? "Save a copy to your templates."
                : "Edit your template."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 px-6">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[0.85rem] font-medium text-muted-foreground">Title</label>
              <span className={`text-[0.78rem] ${title.trim().length < TITLE_MIN ? "text-muted-foreground/50" : "text-muted-foreground"}`}>
                {title.trim().length}/{TITLE_MIN} min
              </span>
            </div>
            <Input
              className="h-8 rounded-[10px] text-[0.95rem]"
              placeholder="e.g. Warm intro"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[0.85rem] font-medium text-muted-foreground">Body</label>
              <span className={`text-[0.78rem] ${body.trim().length < BODY_MIN ? "text-muted-foreground/50" : "text-muted-foreground"}`}>
                {body.trim().length}/{BODY_MIN} min
              </span>
            </div>
            <Textarea
              className="min-h-[160px] resize-none rounded-[10px] text-[0.95rem] leading-relaxed"
              placeholder={"Hi {{name}},\n\n..."}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            className="h-8 rounded-[10px] px-4 text-[0.88rem]"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            className="h-8 rounded-[10px] px-4 text-[0.88rem]"
            onClick={handleSave}
          >
            {mode === "create" ? "Create" : mode === "fork" ? "Save to my templates" : "Save"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
