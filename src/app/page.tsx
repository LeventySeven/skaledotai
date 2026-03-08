import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import Link from "next/link";

export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (session?.user) redirect("/leads");

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center bg-[#F8FAFC]">
      <h1 className="mb-8 text-4xl font-bold tracking-tight text-foreground">mark</h1>
      <Link
        href="/sign-in"
        className="bg-primary text-primary-foreground px-8 py-3 text-sm font-medium"
      >
        Get Started
      </Link>
    </main>
  );
}
