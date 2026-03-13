import { OutreachWorkspace } from "@/components/outreach/OutreachWorkspace";
import { serverTrpc } from "@/lib/trpc/server";

export default async function OutreachPage() {
  const trpc = await serverTrpc();
  const [standardTemplates, savedTemplates] = await Promise.all([
    trpc.outreach.templates(),
    trpc.outreach.savedTemplates(),
  ]);

  return (
    <OutreachWorkspace
      initialStandardTemplates={standardTemplates}
      initialSavedTemplates={savedTemplates}
    />
  );
}
