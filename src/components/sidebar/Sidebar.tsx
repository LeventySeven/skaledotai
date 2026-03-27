"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { SearchIcon, UsersIcon, SendIcon, SettingsIcon, MenuIcon, XIcon, LogOutIcon, SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { signOutAction } from "@/app/(auth)/actions";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";
import { getXDataProviderLabel } from "@/lib/x";
import { LangGraphIcon } from "@/components/ui/langgraph-icon";
import { XLogoIcon } from "@/components/ui/x-icon";
import { useXDataProviderPreference } from "@/components/providers/XDataProviderPreference";
import type { Project } from "@/lib/validations/projects";

function CampaignsIcon({ className }: { className?: string }) {
  return (
    <Image src="/campaigns.svg" alt="" width={16} height={16} className={className} />
  );
}

const navItems = [
  { href: "/search", label: "Search", icon: SearchIcon },
  { href: "/leads", label: "Leads", icon: UsersIcon },
  { href: "/outreach", label: "Outreach", icon: SendIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
  { href: "/projects", label: "Campaigns", icon: CampaignsIcon },
  // { href: "/pricing", label: "Pricing", icon: SparklesIcon },
];

function CampaignsList({ onNav, initialProjects }: { onNav?: () => void; initialProjects?: Project[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: projects = [] } = trpc.projects.list.useQuery(undefined, { initialData: initialProjects });

  if (projects.length === 0) return null;

  return (
    <div className="mt-1 flex flex-col gap-0.5 px-4">
      {projects.map((p) => {
        const href = `/leads?project=${p.id}`;
        const active =
          pathname === "/leads" && searchParams.get("project") === p.id;
        return (
          <Link
            key={p.id}
            href={href}
            onClick={onNav}
            className={cn(
              "flex items-center justify-between rounded-lg px-3 py-2 text-[0.88rem] text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground",
              active && "bg-accent text-foreground font-medium",
            )}
          >
            <span className="truncate">{p.name}</span>
            {p.leadCount !== undefined && (
              <span className="ml-2 shrink-0 text-[0.82rem] text-muted-foreground/70">{p.leadCount}</span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

function SidebarProviderBadge() {
  const { provider } = useXDataProviderPreference();

  return (
    <Link
      href="/settings"
      className="flex items-center justify-between border-t px-5 py-3 transition-colors hover:bg-accent/50"
    >
      <span className="text-[0.78rem] text-muted-foreground">Data source</span>
      <span className="flex items-center gap-1 truncate text-[0.78rem] font-medium">
        {provider === "x-api" ? <><XLogoIcon className="size-3" /> API</> : null}
        {provider === "multiagent" ? <LangGraphIcon className="size-4.5" /> : null}
        {provider !== "x-api" && provider !== "multiagent" ? getXDataProviderLabel(provider) : null}
      </span>
    </Link>
  );
}

function NavContent({ onNav, initialProjects }: { onNav?: () => void; initialProjects?: Project[] }) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav className="flex-1 overflow-y-auto px-3 pt-4">
        <div className="flex flex-col gap-1">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <Button
                key={href}
                render={<Link href={href} onClick={onNav} />}
                variant="ghost"
                className={cn(
                  "h-11 w-full justify-start gap-3 rounded-2xl px-4 text-[1rem] font-normal text-muted-foreground hover:bg-accent/70 hover:text-foreground",
                  active && "bg-accent text-foreground font-medium",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </Button>
            );
          })}
        </div>

        <div className="my-3 border-t border-border/70" />

        <CampaignsList onNav={onNav} initialProjects={initialProjects} />
      </nav>

      <SidebarProviderBadge />

      <form action={signOutAction} className="border-t px-3 pb-4 pt-3">
        <Button
          type="submit"
          variant="ghost"
          className="h-11 w-full justify-start gap-3 rounded-2xl px-4 text-[1rem] font-normal text-muted-foreground hover:bg-accent/70 hover:text-foreground"
        >
          <LogOutIcon className="size-4 shrink-0" />
          Sign out
        </Button>
      </form>
    </div>
  );
}

export function MobileHeader({ initialProjects }: { initialProjects?: Project[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Top bar — mobile only */}
      <header className="flex h-[74px] shrink-0 items-center border-b bg-background px-4 md:hidden">
        <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Open menu">
          <MenuIcon className="size-5" />
        </Button>
        <Link href="/search" className="ml-3">
          <Image src="/Skale.ai.svg" alt="Skale.ai" width={76} height={24} priority />
        </Link>
      </header>

      {/* Drawer backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Drawer */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[228px] flex-col bg-background shadow-xl transition-transform duration-200 md:hidden",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-[74px] items-center justify-between border-b px-7">
          <Link href="/search">
            <Image src="/Skale.ai.svg" alt="Skale.ai" width={76} height={24} priority />
          </Link>
          <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close menu">
            <XIcon className="size-4" />
          </Button>
        </div>
        <NavContent onNav={() => setOpen(false)} initialProjects={initialProjects} />
      </div>
    </>
  );
}

export function Sidebar({ initialProjects }: { initialProjects?: Project[] }) {
  return (
    <aside className="hidden h-screen w-[228px] shrink-0 flex-col border-r bg-background md:flex">
      <div className="flex h-[74px] items-center px-7 shrink-0">
        <Link href="/search">
          <Image src="/Skale.ai.svg" alt="Skale.ai" width={76} height={24} priority />
        </Link>
      </div>

      <Separator />

      <NavContent initialProjects={initialProjects} />
    </aside>
  );
}
