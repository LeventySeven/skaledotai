import { SettingsWorkspace } from "@/components/settings/SettingsWorkspace";
import { serverTrpc } from "@/lib/trpc/server";

export default async function SettingsPage() {
  const trpc = await serverTrpc();
  const [apiKeys, xProviderStatuses, xAccount] = await Promise.all([
    trpc.settings.apiKeys.list(),
    trpc.settings.xProviders.list(),
    trpc.outreach.hasXAccount(),
  ]);

  return (
    <SettingsWorkspace
      initialApiKeys={apiKeys}
      initialXProviderStatuses={xProviderStatuses}
      initialXAccountConnected={xAccount.connected}
    />
  );
}
