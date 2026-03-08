"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";
import { toastManager } from "@/components/ui/toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KeyIcon, PlusIcon, TrashIcon, CopyIcon, CheckIcon, DatabaseIcon } from "lucide-react";

type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsed: string | null;
};

export default function SettingsPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [revealedKey, setRevealedKey] = useState<{ id: string; raw: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Dataset import
  const [datasetId, setDatasetId] = useState("");
  const [importType, setImportType] = useState<"following" | "followers" | "all">("following");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; filtered: number; total: number } | null>(null);

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/api-keys");
      if (!res.ok) throw new Error("Failed to fetch");
      setKeys(await res.json());
    } catch {
      toastManager.add({ type: "error", title: "Failed to load API keys." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchKeys(); }, [fetchKeys]);

  async function handleGenerate() {
    if (!newKeyName.trim()) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/settings/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName.trim() }),
      });
      if (!res.ok) throw new Error("Failed to generate");
      const data = await res.json();
      setRevealedKey({ id: data.id, raw: data.raw });
      setNewKeyName("");
      setShowForm(false);
      await fetchKeys();
    } catch {
      toastManager.add({ type: "error", title: "Failed to generate API key." });
    } finally {
      setGenerating(false);
    }
  }

  async function handleRevoke(id: string) {
    try {
      const res = await fetch(`/api/settings/api-keys/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to revoke");
      setKeys((prev) => prev.filter((k) => k.id !== id));
      if (revealedKey?.id === id) setRevealedKey(null);
      toastManager.add({ type: "success", title: "API key revoked." });
    } catch {
      toastManager.add({ type: "error", title: "Failed to revoke API key." });
    }
  }

  async function handleCopy() {
    if (!revealedKey) return;
    await navigator.clipboard.writeText(revealedKey.raw);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleImportDataset() {
    if (!datasetId.trim()) return;
    setImporting(true);
    setImportResult(null);
    try {
      const res = await fetch("/api/import-dataset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ datasetId: datasetId.trim(), type: importType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setImportResult({ imported: data.imported, filtered: data.filtered, total: data.total });
      toastManager.add({ type: "success", title: `Imported ${data.imported} leads from dataset.` });
    } catch (err) {
      toastManager.add({ type: "error", title: err instanceof Error ? err.message : "Import failed." });
    } finally {
      setImporting(false);
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-xl font-semibold mb-1">Settings</h1>
      <p className="text-sm text-muted-foreground mb-8">Manage your API keys for programmatic access.</p>

      <Separator className="mb-6" />

      {/* Revealed key banner */}
      {revealedKey && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
          <div className="flex items-start gap-3">
            <KeyIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-100 mb-1">
                Copy your API key — it won&apos;t be shown again
              </p>
              <div className="flex items-center gap-2 mt-2">
                <code className="flex-1 truncate rounded bg-white/60 px-2 py-1 text-xs font-mono text-amber-900 dark:bg-black/40 dark:text-amber-200 border border-amber-200 dark:border-amber-700">
                  {revealedKey.raw}
                </code>
                <Button variant="outline" size="sm" onClick={handleCopy} className="shrink-0 gap-1.5">
                  {copied ? <CheckIcon className="size-3.5 text-green-600" /> : <CopyIcon className="size-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium">API Keys</h2>
        {!showForm && (
          <Button size="sm" variant="outline" onClick={() => setShowForm(true)} className="gap-1.5">
            <PlusIcon className="size-3.5" />
            Generate New Key
          </Button>
        )}
      </div>

      {/* New key form */}
      {showForm && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border bg-muted/40 p-3">
          <Input
            placeholder="Key name (e.g. skill)"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
            className="flex-1 h-8 text-sm"
            autoFocus
          />
          <Button size="sm" onClick={handleGenerate} disabled={!newKeyName.trim() || generating} className="gap-1.5">
            {generating && <Spinner className="size-3.5" />}
            Generate
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setShowForm(false); setNewKeyName(""); }}>
            Cancel
          </Button>
        </div>
      )}

      {/* Keys table */}
      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Spinner className="size-4" /> Loading...
        </div>
      ) : keys.length === 0 ? (
        <div className="rounded-lg border border-dashed py-12 text-center">
          <KeyIcon className="mx-auto size-8 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">No API keys yet.</p>
          <p className="text-xs text-muted-foreground mt-1">Generate a key to access the API programmatically.</p>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Name</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Prefix</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Created</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Last Used</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {keys.map((key) => (
                <tr key={key.id} className="bg-background hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-medium">{key.name}</td>
                  <td className="px-4 py-3">
                    <Badge variant="secondary" className="font-mono text-xs">
                      {key.prefix}…
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(key.createdAt)}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {key.lastUsed ? formatDate(key.lastUsed) : "Never"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground hover:text-destructive"
                      onClick={() => handleRevoke(key.id)}
                    >
                      <TrashIcon className="size-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Separator className="my-8" />

      {/* Import from Apify Dataset */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <DatabaseIcon className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Import from Apify Dataset</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Paste an Apify dataset ID from a completed run to import accounts directly into the DB.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            placeholder="Dataset ID (e.g. abc123xyz)"
            value={datasetId}
            onChange={(e) => setDatasetId(e.target.value)}
            className="flex-1 text-sm"
          />
          <Select value={importType} onValueChange={(v) => setImportType(v as typeof importType)}>
            <SelectTrigger className="w-full sm:w-36 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="following">Following only</SelectItem>
              <SelectItem value="followers">Followers only</SelectItem>
              <SelectItem value="all">All accounts</SelectItem>
            </SelectContent>
          </Select>
          <Button
            onClick={handleImportDataset}
            disabled={!datasetId.trim() || importing}
            className="gap-1.5"
          >
            {importing && <Spinner className="size-4" />}
            {importing ? "Importing…" : "Import"}
          </Button>
        </div>
        {importResult && (
          <p className="mt-2 text-xs text-muted-foreground">
            Done — {importResult.imported} leads upserted
            {importResult.total !== importResult.filtered
              ? ` (${importResult.filtered} matched filter out of ${importResult.total} total)`
              : ` from ${importResult.total} items`}.
          </p>
        )}
      </div>

      <Separator className="my-8" />

      <div className="text-sm text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">Using the API</p>
        <p>Pass your key as an <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">x-api-key</code> header on all requests to <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">/api/v1/*</code>.</p>
        <p className="pt-1">See <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">SKILL.md</code> at the project root for the full endpoint reference.</p>
      </div>
    </div>
  );
}
