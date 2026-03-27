"use client";

import {
  Sheet, SheetPopup, SheetHeader, SheetTitle, SheetDescription,
  SheetPanel,
} from "@/components/ui/sheet";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from "@/components/ui/select";
import { ExternalLinkIcon } from "lucide-react";
import type { ContraLead } from "@/lib/validations/contra";
import { cn } from "@/lib/utils";

interface ContraDetailSheetProps {
  lead: ContraLead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPatch: (id: string, data: Partial<ContraLead>) => Promise<void>;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

function initials(name: string): string {
  return name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

export function ContraDetailSheet({ lead, open, onOpenChange, onPatch }: ContraDetailSheetProps) {
  if (!lead) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetPopup side="right">
        <SheetHeader>
          <div className="flex items-start gap-4 pr-8">
            <Avatar className="size-14 shrink-0">
              {lead.avatarUrl && <AvatarImage src={lead.avatarUrl} alt={lead.name} />}
              <AvatarFallback>{initials(lead.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <SheetTitle>{lead.name}</SheetTitle>
              <SheetDescription className="mt-0.5">{lead.bio}</SheetDescription>
              <div className="mt-2 flex gap-1.5">
                <Badge variant="secondary" className="text-xs">X / Twitter</Badge>
                {lead.relevancy && (
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-xs border-transparent",
                      lead.relevancy === "high" ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {lead.relevancy}
                  </Badge>
                )}
                {lead.source && (
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-xs border-transparent",
                      lead.source === "influencer" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700",
                    )}
                  >
                    {lead.source}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </SheetHeader>

        <SheetPanel>
          {/* Profile Stats */}
          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <span className="text-muted-foreground">Followers</span>
            <span className="font-medium">{formatNumber(lead.followers)}</span>
            {lead.following !== undefined && (
              <>
                <span className="text-muted-foreground">Following</span>
                <span className="font-medium">{formatNumber(lead.following)}</span>
              </>
            )}
            {lead.price != null && (
              <>
                <span className="text-muted-foreground">Price</span>
                <span className="font-medium">${lead.price}</span>
              </>
            )}
          </div>

          <Separator className="my-4" />

          {/* Tags */}
          {lead.tags.length > 0 && (
            <>
              <div className="mb-3">
                <Label className="text-xs text-muted-foreground">Tags</Label>
                <div className="mt-1 flex flex-wrap gap-1">
                  {lead.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                  ))}
                </div>
              </div>
              <Separator className="my-4" />
            </>
          )}

          {/* Links */}
          <div className="space-y-2">
            {lead.url && (
              <a href={lead.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline">
                <ExternalLinkIcon className="size-3.5" /> Profile
              </a>
            )}
            {lead.site && (
              <a href={lead.site} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline">
                <ExternalLinkIcon className="size-3.5" /> Website
              </a>
            )}
            {lead.linkedinUrl && (
              <a href={lead.linkedinUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline">
                <ExternalLinkIcon className="size-3.5" /> LinkedIn
              </a>
            )}
          </div>

          <Separator className="my-4" />

          {/* CRM Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Label className="text-sm">Priority</Label>
              <div className="flex gap-1">
                {(["P0", "P1"] as const).map((p) => (
                  <Button
                    key={p}
                    variant={lead.priority === p ? "default" : "outline"}
                    className="h-7 px-2.5 text-xs"
                    onClick={() => onPatch(lead.id, { priority: p })}
                  >
                    {p}
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="dm-comfort"
                checked={lead.dmComfort}
                onCheckedChange={(value) => onPatch(lead.id, { dmComfort: Boolean(value) })}
              />
              <Label htmlFor="dm-comfort" className="text-sm">Comfortable DMing?</Label>
            </div>

            <div>
              <Label className="text-sm">Stage</Label>
              <Select
                value={lead.stage}
                onValueChange={(value) => onPatch(lead.id, { stage: value as ContraLead["stage"] })}
              >
                <SelectTrigger className="mt-1 h-8 rounded-lg text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="found">found</SelectItem>
                  <SelectItem value="messaged">messaged</SelectItem>
                  <SelectItem value="replied">replied</SelectItem>
                  <SelectItem value="agreed">agreed</SelectItem>
                </SelectPopup>
              </Select>
            </div>

            <div>
              <Label className="text-sm">The Ask</Label>
              <Textarea
                className="mt-1 text-sm"
                rows={3}
                value={lead.theAsk}
                onChange={(e) => onPatch(lead.id, { theAsk: e.target.value })}
              />
            </div>

            <div>
              <Label className="text-sm">Email</Label>
              <Input
                className="mt-1 h-8 text-sm"
                value={lead.email ?? ""}
                placeholder="Not enriched yet"
                onChange={(e) => onPatch(lead.id, { email: e.target.value || undefined })}
              />
            </div>

            <div>
              <Label className="text-sm">Notes</Label>
              <Textarea
                className="mt-1 text-sm"
                rows={3}
                value={lead.notes ?? ""}
                onChange={(e) => onPatch(lead.id, { notes: e.target.value || undefined })}
              />
            </div>
          </div>
        </SheetPanel>
      </SheetPopup>
    </Sheet>
  );
}
