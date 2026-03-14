import { redirect } from "next/navigation";
import { Sidebar, MobileHeader } from "@/components/sidebar/Sidebar";
import { XDataProviderPreferenceProvider } from "@/components/providers/XDataProviderPreference";
import { TRPCProvider } from "@/lib/trpc/react";
import { getRequestSession } from "@/lib/auth-session";

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getRequestSession();

  if (!session?.user) redirect("/sign-in");

  return (
    <TRPCProvider>
      <XDataProviderPreferenceProvider>
        <div className="flex h-screen overflow-hidden bg-background">
          <Sidebar />
          <div className="flex flex-1 flex-col overflow-hidden">
            <MobileHeader />
            <main className="flex-1 overflow-y-auto">
              {children}
            </main>
          </div>
        </div>
      </XDataProviderPreferenceProvider>
    </TRPCProvider>
  );
}
