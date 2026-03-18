"use client";

import { type FormEvent, useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { XDataProviderSelector } from "@/components/providers/XDataProviderSelector";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toastManager } from "@/components/ui/toast";
import { trpc } from "@/lib/trpc/client";
import { authClient } from "@/lib/auth-client";
import { XIcon } from "@/components/auth/icons";
import type { XProviderRuntimeStatus } from "@/lib/x/registry";

function ConnectXSection({ initialConnected }: { initialConnected: boolean }) {
  const { data } = trpc.outreach.hasXAccount.useQuery(undefined, { initialData: { connected: initialConnected } });
  const connected = data?.connected ?? initialConnected;
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnectX = async () => {
    setIsConnecting(true);
    try {
      await authClient.signIn.social({
        provider: "twitter",
        callbackURL: "/settings",
      });
    } catch {
      toastManager.add({ type: "error", title: "Failed to connect X account." });
      setIsConnecting(false);
    }
  };

  return (
    <div className="mb-8">
      <div className="mb-5">
        <div className="mb-1 flex items-center gap-2 text-[18px] font-medium text-[#111111]"><XIcon className="size-4" /> Account</div>
        <div className="text-[16px] font-normal text-muted-foreground">
          Connect your <XIcon className="inline size-3.5 align-[-2px]" /> account to send DMs directly from Skale.
        </div>
      </div>
      {connected ? (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-[10px] border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[0.95rem] text-emerald-950">
            <XIcon className="size-4" />
            connected
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          className="h-9 gap-2 rounded-[10px] bg-black px-4 text-[0.88rem] text-white hover:bg-black/90 hover:text-white"
          disabled={isConnecting}
          onClick={() => { handleConnectX().catch(() => undefined); }}
        >
          <XIcon className="size-4" />
          {isConnecting ? "Connecting..." : "Connect X Account"}
        </Button>
      )}
    </div>
  );
}

function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "Never";
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface SettingsWorkspaceProps {
  initialApiKeys?: { id: string; name: string; prefix: string; createdAt: Date | string; lastUsed: Date | string | null }[];
  initialXProviderStatuses?: XProviderRuntimeStatus[];
  initialXAccountConnected?: boolean;
}

export function SettingsWorkspace({ initialApiKeys, initialXProviderStatuses, initialXAccountConnected }: SettingsWorkspaceProps) {
  const utils = trpc.useUtils();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [name, setName] = useState("");
  const [latestKey, setLatestKey] = useState<string | null>(null);
  const normalizedInitialApiKeys = initialApiKeys?.map((k) => ({
    ...k,
    createdAt: new Date(k.createdAt),
    lastUsed: k.lastUsed ? new Date(k.lastUsed) : null,
  }));
  const listQuery = trpc.settings.apiKeys.list.useQuery(undefined, { initialData: normalizedInitialApiKeys });
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
    <div className="mx-auto max-w-[1700px] px-8 py-8">
      <div className="flex w-full items-start justify-between pb-6">
        <div className="flex flex-col">
          <div className="text-[18px] font-medium text-[#111111]/40">Global</div>
          <h1 className="text-[28px] font-medium tracking-[-0.04em]">Settings</h1>
        </div>
      </div>
      <div className="-mx-8 mb-5 border-b border-border/70" />

      <div className="mb-8">
        <div className="mb-5">
          <div className="mb-1 text-[18px] font-medium text-[#111111]">Data source</div>
          <div className="text-[16px] font-normal text-muted-foreground">
            Choose the provider Skale uses for search, imports, stats, and AI analysis.
          </div>
        </div>
        <XDataProviderSelector initialStatuses={initialXProviderStatuses} />
      </div>

      <div className="-mx-8 mb-8 border-b border-border/70" />

      <ConnectXSection initialConnected={initialXAccountConnected ?? false} />

      <div className="-mx-8 mb-8 border-b border-border/70" />

      <div className="flex items-center justify-between gap-4">
        <div className="text-[18px] font-medium text-[#111111]">API Keys</div>
        <Button
          variant="outline"
          className="h-8 rounded-[10px] px-2.5 text-[0.88rem]"
          onClick={() => setShowCreateForm((current) => !current)}
        >
          <PlusIcon className="size-4" />
          Generate New Key
        </Button>
      </div>

      {showCreateForm && (
        <form className="mt-3 flex items-center gap-3" onSubmit={handleCreate}>
          <Input
            className="h-8 rounded-[10px] text-[0.88rem]"
            placeholder="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
          <Button className="h-8 rounded-[10px] px-4 text-[0.88rem]" disabled={createKey.isPending}>
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
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => deleteKey.mutate({ id: key.id })}
                    >
                      <Trash2Icon className="size-4.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

    </div>
  );
}
