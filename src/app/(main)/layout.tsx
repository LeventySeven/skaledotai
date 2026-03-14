import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Sidebar, MobileHeader } from "@/components/sidebar/Sidebar";
import { XDataProviderPreferenceProvider } from "@/components/providers/XDataProviderPreference";
import { parseXDataProvider } from "@/lib/x";
import { TRPCProvider } from "@/lib/trpc/react";
import { getRequestSession } from "@/lib/auth-session";
import { serverTrpc } from "@/lib/trpc/server";

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getRequestSession();

  if (!session?.user) redirect("/sign-in");

  const cookieStore = await cookies();
  const initialProvider = parseXDataProvider(cookieStore.get("skaleai.x-data-provider")?.value);
  const trpc = await serverTrpc();
  const initialProjects = await trpc.projects.list();

  return (
    <TRPCProvider>
      <XDataProviderPreferenceProvider initialProvider={initialProvider}>
        <div className="flex h-screen overflow-hidden bg-background">
          <Sidebar initialProjects={initialProjects} />
          <div className="flex flex-1 flex-col overflow-hidden">
            <MobileHeader initialProjects={initialProjects} />
            <main className="flex-1 overflow-y-auto">
              {children}
            </main>
          </div>
        </div>
      </XDataProviderPreferenceProvider>
    </TRPCProvider>
  );
}
