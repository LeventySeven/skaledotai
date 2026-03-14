"use client";

import { startTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, FolderOpenIcon, RotateCwIcon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getXDataProviderOption } from "@/lib/x";
import type { ProjectOverview } from "@/lib/validations/projects";

function formatFollowers(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function initials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function deriveSummary(project: ProjectOverview): string {
  if (project.leadCount === 0) return "No leads yet.";
  return `${project.leadCount} leads, ${formatFollowers(project.avgFollowers)} avg followers, ${formatFollowers(project.topFollowers)} top follower, ${project.p0LeadCount} P0 leads.`;
}

export function ProjectCard({
  project,
  analysisMode,
  selected,
  onToggle,
}: {
  project: ProjectOverview;
  analysisMode: boolean;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  const router = useRouter();

  return (
    <div
      onClick={() => onToggle(project.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle(project.id);
        }
      }}
      role="button"
      tabIndex={0}
      className={`overflow-hidden rounded-[1.2rem] border bg-card text-left transition-colors ${
        analysisMode
          ? selected
            ? "border-foreground/20 ring-1 ring-foreground/10"
            : "border-border opacity-70"
          : "border-border hover:border-foreground/20"
      }`}
    >
      <div className="flex items-start justify-between gap-4 border-b border-border/60 px-5 py-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="text-[1.15rem] font-semibold">{project.name}</div>
            {project.sourceProviders.map((provider) => (
              <Badge key={provider} variant="outline" className="h-6 rounded-full px-2 text-[0.72rem] font-semibold">
                {getXDataProviderOption(provider).label}
              </Badge>
            ))}
            {analysisMode && selected ? (
              <Badge className="h-6 rounded-full px-2 text-[0.72rem] font-semibold">
                <CheckIcon className="size-3.5" />
                Included
              </Badge>
            ) : null}
          </div>
          <div className="mt-1 text-[0.92rem] text-muted-foreground">
            {deriveSummary(project)}
          </div>
        </div>

        {!analysisMode ? (
          <div className="flex items-center gap-2">
            {project.query ? (
              <Button
                variant="ghost"
                className="h-9 rounded-xl px-3 text-[0.88rem]"
                onClick={(event) => {
                  event.stopPropagation();
                  const params = new URLSearchParams({ project: project.id, query: project.query! });
                  if (project.latestRunParams?.minFollowers != null) {
                    params.set("minFollowers", String(project.latestRunParams.minFollowers));
                  }
                  if (project.latestRunParams?.targetLeadCount != null) {
                    params.set("targetLeadCount", String(project.latestRunParams.targetLeadCount));
                  }
                  if (project.latestRunParams?.requestedProvider) {
                    params.set("provider", project.latestRunParams.requestedProvider);
                  }
                  startTransition(() => {
                    router.push(`/search?${params.toString()}`);
                  });
                }}
              >
                <RotateCwIcon className="size-3.5" />
                Re-run
              </Button>
            ) : null}
            <Button
              variant="outline"
              className="h-9 rounded-xl px-3 text-[0.88rem]"
              onClick={(event) => {
                event.stopPropagation();
                startTransition(() => {
                  router.push(`/leads?project=${project.id}`);
                });
              }}
            >
              <FolderOpenIcon className="size-4" />
              Open
            </Button>
          </div>
        ) : null}
      </div>

      <div className="px-5 py-4">
        <div className="mb-3 text-[0.85rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Preview
        </div>
        <div className="overflow-hidden rounded-lg border border-border/70">
          <div className="grid grid-cols-[minmax(0,1fr)_88px_64px] border-b border-border/60 bg-muted/10 px-3 py-2 text-[0.8rem] font-medium text-muted-foreground">
            <div>Name</div>
            <div className="text-center">Followers</div>
            <div className="text-center">P</div>
          </div>
          {project.previewLeads.length === 0 ? (
            <div className="px-3 py-5 text-[0.9rem] text-muted-foreground">No leads yet.</div>
          ) : (
            project.previewLeads.map((lead) => (
              <div
                key={lead.id}
                className="grid grid-cols-[minmax(0,1fr)_88px_64px] items-center border-b border-border/45 px-3 py-2.5 last:border-b-0"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar className="size-8">
                    {lead.avatarUrl ? <AvatarImage src={lead.avatarUrl} alt={lead.name} /> : null}
                    <AvatarFallback>{initials(lead.name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="truncate text-[0.92rem] font-medium">{lead.name}</div>
                    <div className="truncate text-[0.82rem] text-muted-foreground">@{lead.handle}</div>
                  </div>
                </div>
                <div className="text-center text-[0.88rem] font-semibold">
                  {formatFollowers(lead.followers)}
                </div>
                <div className="text-center">
                  <Badge
                    variant="outline"
                    className="h-6 rounded-sm border-transparent px-1.5 text-[0.72rem] font-semibold"
                  >
                    {lead.priority}
                  </Badge>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
