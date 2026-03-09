"use client";

import { type FormEvent, useState } from "react";
import { KeyRoundIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toastManager } from "@/components/ui/toast";
import { trpc } from "@/lib/trpc/client";

function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

export function SettingsWorkspace() {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [latestKey, setLatestKey] = useState<string | null>(null);
  const listQuery = trpc.settings.apiKeys.list.useQuery();
  const createKey = trpc.settings.apiKeys.create.useMutation({
    onSuccess: async (result) => {
      setLatestKey(result.key);
      setName("");
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await createKey.mutateAsync({ name: name.trim() });
  }

  const keys = listQuery.data ?? [];

  return (
    <div className="space-y-6 p-6 md:p-8">
      <section className="rounded-3xl border bg-card p-6 shadow-sm/5">
        <p className="text-sm font-medium text-muted-foreground">Settings</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Manage access keys</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          This keeps the existing settings router intact. Keys are generated once, hashed before storage, and can be revoked from here.
        </p>
      </section>

      <section className="rounded-2xl border bg-card p-6 shadow-sm/5">
        <div className="mb-4">
          <h2 className="text-lg font-semibold">Create API key</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The raw key is shown only once after creation.
          </p>
        </div>

        <form className="flex flex-col gap-3 md:flex-row" onSubmit={handleSubmit}>
          <Input
            placeholder="Internal integration"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
          <Button disabled={createKey.isPending}>
            {createKey.isPending ? <Spinner className="size-4" /> : <KeyRoundIcon className="size-4" />}
            {createKey.isPending ? "Creating..." : "Create key"}
          </Button>
        </form>

        {latestKey && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
            <p className="font-medium">New API key</p>
            <p className="mt-2 font-mono text-xs md:text-sm">{latestKey}</p>
          </div>
        )}
      </section>

      <section className="rounded-2xl border bg-card shadow-sm/5">
        {listQuery.isLoading ? (
          <div className="flex items-center justify-center p-10 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            <span className="ml-2">Loading keys...</span>
          </div>
        ) : keys.length === 0 ? (
          <Empty className="py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <KeyRoundIcon />
              </EmptyMedia>
              <EmptyTitle>No API keys yet</EmptyTitle>
              <EmptyDescription>
                Create a key to use the app from external systems.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Prefix</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((key) => (
                <TableRow key={key.id}>
                  <TableCell className="font-medium">{key.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{key.prefix}</Badge>
                  </TableCell>
                  <TableCell>{formatDate(key.createdAt)}</TableCell>
                  <TableCell>{formatDate(key.lastUsed)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <Button
                        size="xs"
                        variant="destructive-outline"
                        onClick={() => deleteKey.mutate({ id: key.id })}
                      >
                        <Trash2Icon className="size-3.5" />
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
