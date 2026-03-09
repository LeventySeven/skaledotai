"use client";

import { type FormEvent, useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toastManager } from "@/components/ui/toast";
import { trpc } from "@/lib/trpc/client";

function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "Never";
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function SettingsWorkspace() {
  const utils = trpc.useUtils();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [name, setName] = useState("");
  const [latestKey, setLatestKey] = useState<string | null>(null);
  const listQuery = trpc.settings.apiKeys.list.useQuery();
  const createKey = trpc.settings.apiKeys.create.useMutation({
    onSuccess: async (result) => {
      setLatestKey(result.key);
      setName("");
      setShowCreateForm(false);
      await utils.settings.apiKeys.list.invalidate();
      toastManager.add({ type: "success", title: `Created ${result.name}.` });
    },
    onError: (error) => {
      toastManager.add({ type: "error", title: error.message });
    },
  });
  const deleteKey = trpc.settings.apiKeys.delete.useMutation({
    onSuccess: async () => {
      await utils.settings.apiKeys.list.invalidate();
      toastManager.add({ type: "success", title: "API key deleted." });
    },
    onError: (error) => {
      toastManager.add({ type: "error", title: error.message });
    },
  });

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await createKey.mutateAsync({ name: name.trim() });
  }

  const keys = listQuery.data ?? [];

  return (
    <div className="mx-auto max-w-[980px] px-8 py-12">
      <h1 className="text-[3rem] font-semibold tracking-[-0.04em]">Settings</h1>
      <p className="mt-2 text-[1.05rem] text-muted-foreground">
        Manage your API keys for programmatic access.
      </p>

      <div className="my-12 h-px bg-border" />

      <div className="flex items-center justify-between gap-4">
        <h2 className="text-[1.95rem] font-semibold tracking-[-0.03em]">API Keys</h2>
        <Button
          variant="outline"
          className="h-[40px] rounded-2xl px-5 text-[1rem]"
          onClick={() => setShowCreateForm((current) => !current)}
        >
          <PlusIcon className="size-4" />
          Generate New Key
        </Button>
      </div>

      {showCreateForm && (
        <form className="mt-6 flex gap-3" onSubmit={handleCreate}>
          <Input
            className="h-[44px] rounded-2xl text-[1rem]"
            placeholder="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
          <Button className="h-[44px] rounded-2xl px-5 text-[1rem]" disabled={createKey.isPending}>
            {createKey.isPending ? "Generating..." : "Generate"}
          </Button>
        </form>
      )}

      {latestKey && (
        <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
          <div className="font-semibold">New API key</div>
          <div className="mt-2 font-mono">{latestKey}</div>
        </div>
      )}

      <div className="mt-6 overflow-hidden rounded-[1.25rem] border border-border bg-card">
        <Table className="text-[1rem]">
          <TableHeader>
            <TableRow className="h-14 hover:bg-transparent">
              <TableHead>Name</TableHead>
              <TableHead>Prefix</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Last Used</TableHead>
              <TableHead className="w-[70px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQuery.isLoading ? (
              <TableRow className="h-[120px] hover:bg-transparent">
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Loading keys...
                </TableCell>
              </TableRow>
            ) : keys.length === 0 ? (
              <TableRow className="h-[120px] hover:bg-transparent">
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No API keys yet.
                </TableCell>
              </TableRow>
            ) : (
              keys.map((key) => (
                <TableRow key={key.id} className="h-[80px] border-b">
                  <TableCell className="font-semibold">{key.name}</TableCell>
                  <TableCell>
                    <span className="rounded-md bg-muted px-2 py-1 font-mono text-sm">{key.prefix}...</span>
                  </TableCell>
                  <TableCell>{formatDate(key.createdAt)}</TableCell>
                  <TableCell>{formatDate(key.lastUsed)}</TableCell>
                  <TableCell>
                    <button
                      type="button"
                      className="inline-flex size-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      onClick={() => deleteKey.mutate({ id: key.id })}
                    >
                      <Trash2Icon className="size-4.5" />
                    </button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="my-12 h-px bg-border" />

      <div>
        <h3 className="text-[1.8rem] font-semibold tracking-[-0.03em]">Using the API</h3>
        <p className="mt-3 text-[1rem] text-muted-foreground">
          Pass your key as an <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-[0.94rem]">x-api-key</span>{" "}
          header on all requests to <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-[0.94rem]">/api/v1/*</span>.
        </p>
        <p className="mt-4 text-[1rem] text-muted-foreground">
          See <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-[0.94rem]">SKILL.md</span> at the project root for the full endpoint reference.
        </p>
      </div>
    </div>
  );
}
