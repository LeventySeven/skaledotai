import { SearchWorkspace } from "@/components/search/SearchWorkspace";
import { serverTrpc } from "@/lib/trpc/server";

export default async function SearchPage() {
  const trpc = await serverTrpc();
  const xAccount = await trpc.outreach.hasXAccount();

  return <SearchWorkspace initialXAccountConnected={xAccount.connected} />;
}
