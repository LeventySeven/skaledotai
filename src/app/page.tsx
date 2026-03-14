import { redirect } from "next/navigation";
import Link from "next/link";
import { getRequestSession } from "@/lib/auth-session";

export default async function Home() {
  const session = await getRequestSession();

  if (session?.user) redirect("/leads");

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-soft-white">
      <h1 className="mb-8 text-4xl font-bold tracking-tight text-foreground">skaleai</h1>
      <Link
        href="/sign-in"
        className="bg-primary text-primary-foreground px-8 py-3 text-sm font-medium"
      >
        Get Started
      </Link>
    </main>
  );
}
