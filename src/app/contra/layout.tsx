import { redirect } from "next/navigation";
import { TRPCProvider } from "@/lib/trpc/react";
import { getRequestSession } from "@/lib/auth-session";

export default async function ContraLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getRequestSession();
  if (!session?.user) redirect("/sign-in");

  return (
    <TRPCProvider>
      <main className="min-h-screen bg-background">
        {children}
      </main>
    </TRPCProvider>
  );
}
