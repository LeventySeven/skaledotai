import { redirect } from "next/navigation";
import { getRequestSession } from "@/lib/auth-session";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const session = await getRequestSession();
  if (session?.user) redirect("/leads");
  return <>{children}</>;
}
