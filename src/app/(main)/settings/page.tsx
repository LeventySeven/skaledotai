import { SettingsWorkspace } from "@/components/settings/SettingsWorkspace";
import { serverTrpc } from "@/lib/trpc/server";

export default async function SettingsPage() {
  const trpc = await serverTrpc();
  const xAccount = await trpc.outreach.hasXAccount();

  return (
    <SettingsWorkspace
      initialXAccountConnected={xAccount.connected}
    />
  );
}
