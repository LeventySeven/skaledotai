"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsiblePanel } from "@/components/ui/collapsible";
import { ToggleGroup, Toggle } from "@/components/ui/toggle-group";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Alert } from "@/components/ui/alert";
import { Select, SelectTrigger, SelectContent, SelectItem } from "@/components/ui/select";
import { AlertCircleIcon } from "lucide-react";
import type { Project } from "@/lib/types";

type Platform = "twitter" | "linkedin" | "both";

const NEW_PROJECT = "__new__";

export default function SearchPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [projectMode, setProjectMode] = useState<string>(NEW_PROJECT); // project id or "__new__"
  const [projectName, setProjectName] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [platform, setPlatform] = useState<Platform>("both");

  const platformValue = [platform];
  const [searchFollowers, setSearchFollowers] = useState(false);
  const [handle, setHandle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [importHandle, setImportHandle] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => Array.isArray(d) && setProjects(d))
      .catch(() => {});
  }, []);

  async function handleSearch() {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const isExisting = projectMode !== NEW_PROJECT;
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          platform,
          followerUsername: searchFollowers ? handle : undefined,
          projectId: isExisting ? projectMode : undefined,
          projectName: !isExisting ? (projectName.trim() || undefined) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Search failed");
      sessionStorage.setItem("openclaw_leads", JSON.stringify(data.leads));
      const projectId = data.project?.id;
      router.push(projectId ? `/leads?project=${projectId}` : "/leads");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleImportFollowers() {
    if (!importHandle.trim()) return;
    setImporting(true);
    setImportError(null);
    try {
      const res = await fetch("/api/followers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: importHandle.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      router.push("/leads");
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed. Please try again.");
    } finally {
      setImporting(false);
    }
  }

  const handleLabel =
    platform === "linkedin" ? "LinkedIn profile URL" : "@ Twitter handle";

  return (
    <div className="flex min-h-full items-start justify-center px-6 py-16">
      <div className="w-full max-w-[560px] space-y-8">
        {/* Heading */}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Find people in any niche on X/Twitter or LinkedIn.
          </p>
        </div>

        {/* Query */}
        <div className="space-y-1.5">
          <Label htmlFor="query">What are you looking for?</Label>
          <Input
            id="query"
            placeholder="e.g. best product designers"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !loading && handleSearch()}
            disabled={loading}
          />
        </div>

        {/* Project */}
        <div className="space-y-1.5">
          <Label>Project <span className="text-muted-foreground font-normal">(optional)</span></Label>
          <Select value={projectMode} onValueChange={(v) => v && setProjectMode(v)} disabled={loading}>
            <SelectTrigger>
              <span className="truncate">
                {projectMode === NEW_PROJECT
                  ? "Create new project"
                  : (projects.find((p) => p.id === projectMode)?.name ?? "Select project")}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NEW_PROJECT}>+ Create new project</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {projectMode === NEW_PROJECT && (
            <Input
              placeholder={query.trim() || "e.g. Designers campaign"}
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              disabled={loading}
            />
          )}
          <p className="text-xs text-muted-foreground">
            {projectMode === NEW_PROJECT
              ? "A new project will be created. Defaults to the search query."
              : "Results will be added to the selected project."}
          </p>
        </div>

        {/* Platform */}
        <div className="space-y-1.5">
          <Label>Platform</Label>
          <ToggleGroup
            value={platformValue}
            onValueChange={(v) => v.length && setPlatform(v[v.length - 1] as Platform)}
            variant="outline"
          >
            <Toggle value="twitter">X / Twitter</Toggle>
            <Toggle value="linkedin">LinkedIn</Toggle>
            <Toggle value="both">Both</Toggle>
          </ToggleGroup>
        </div>

        {/* Followers toggle */}
        <Collapsible open={searchFollowers} onOpenChange={setSearchFollowers}>
          <div className="flex items-center gap-2">
            <Checkbox
              id="followers"
              checked={searchFollowers}
              onCheckedChange={(v) => setSearchFollowers(Boolean(v))}
              disabled={loading}
            />
            <Label htmlFor="followers" className="cursor-pointer font-normal">
              Search within a user&apos;s followers
            </Label>
          </div>
          <CollapsiblePanel>
            <div className="mt-3 space-y-1.5 pl-6">
              <Label htmlFor="handle">{handleLabel}</Label>
              <Input
                id="handle"
                placeholder={
                  platform === "linkedin"
                    ? "linkedin.com/in/username"
                    : "@username"
                }
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                disabled={loading}
              />
            </div>
          </CollapsiblePanel>
        </Collapsible>

        {/* Error */}
        {error && (
          <Alert variant="error">
            <AlertCircleIcon className="size-4" />
            {error}
          </Alert>
        )}

        {/* Action */}
        <div className="space-y-3">
          <Button
            className="w-full"
            onClick={handleSearch}
            disabled={loading || !query.trim()}
          >
            {loading ? (
              <>
                <Spinner className="size-4" />
                Searching…
              </>
            ) : (
              "Run Search"
            )}
          </Button>

          {loading && (
            <div className="space-y-1.5">
              <Progress value={null} />
              <p className="text-center text-xs text-muted-foreground">
                Searching via Apify, this may take a few seconds…
              </p>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t" />
          </div>
          <div className="relative flex justify-center">
            <span className="bg-background px-3 text-xs text-muted-foreground">or</span>
          </div>
        </div>

        {/* Import Followers */}
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium">Import followers</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Import all followers & following from a Twitter account directly into your leads.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="import-handle">Twitter handle</Label>
            <Input
              id="import-handle"
              placeholder="@MarkKnd"
              value={importHandle}
              onChange={(e) => setImportHandle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !importing && handleImportFollowers()}
              disabled={importing}
            />
          </div>
          {importError && (
            <Alert variant="error">
              <AlertCircleIcon className="size-4" />
              {importError}
            </Alert>
          )}
          <div className="space-y-3">
            <Button
              variant="outline"
              className="w-full"
              onClick={handleImportFollowers}
              disabled={importing || !importHandle.trim()}
            >
              {importing ? (
                <>
                  <Spinner className="size-4" />
                  Importing…
                </>
              ) : (
                "Import Followers"
              )}
            </Button>
            {importing && (
              <div className="space-y-1.5">
                <Progress value={null} />
                <p className="text-center text-xs text-muted-foreground">
                  This may take a few minutes for large accounts…
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
