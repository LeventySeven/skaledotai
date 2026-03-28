"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toastManager } from "@/components/ui/toast";
import { trpc } from "@/lib/trpc/client";
import { authClient } from "@/lib/auth-client";
import { XIcon } from "@/components/auth/icons";

function ConnectXSection({ initialConnected }: { initialConnected: boolean }) {
  const utils = trpc.useUtils();
  const { data } = trpc.outreach.hasXAccount.useQuery(undefined, { initialData: { connected: initialConnected } });
  const connected = data?.connected ?? initialConnected;
  const [isConnecting, setIsConnecting] = useState(false);

  const disconnect = trpc.outreach.disconnectXAccount.useMutation({
    onSuccess: async () => {
      await utils.outreach.hasXAccount.invalidate();
      toastManager.add({ type: "success", title: "X account disconnected." });
    },
    onError: (error) => {
      toastManager.add({ type: "error", title: error.message });
    },
  });

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
          <Button
            variant="outline"
            className="h-9 rounded-[10px] px-4 text-[0.88rem]"
            disabled={disconnect.isPending}
            onClick={() => disconnect.mutate()}
          >
            {disconnect.isPending ? "Disconnecting..." : "Disconnect"}
          </Button>
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

interface SettingsWorkspaceProps {
  initialXAccountConnected?: boolean;
}

export function SettingsWorkspace({ initialXAccountConnected }: SettingsWorkspaceProps) {
  return (
    <div className="mx-auto max-w-[1700px] px-8 py-8">
      <div className="flex w-full items-start justify-between pb-6">
        <div className="flex flex-col">
          <div className="text-[18px] font-medium text-[#111111]/40">Global</div>
          <h1 className="text-[28px] font-medium tracking-[-0.04em]">Settings</h1>
        </div>
      </div>
      <div className="-mx-8 mb-5 border-b border-border/70" />

      <ConnectXSection initialConnected={initialXAccountConnected ?? false} />
    </div>
  );
}
