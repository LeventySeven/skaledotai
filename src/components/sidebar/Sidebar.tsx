"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { SearchIcon, UsersIcon, SendIcon, SettingsIcon, MenuIcon, XIcon, FolderIcon, ChevronRightIcon, LogOutIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { signOutAction } from "@/app/(auth)/actions";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";

const navItems = [
  { href: "/search", label: "Search", icon: SearchIcon },
  { href: "/leads", label: "Leads", icon: UsersIcon },
  { href: "/outreach", label: "Outreach", icon: SendIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

function ProjectsList({ onNav }: { onNav?: () => void }) {
  const [expanded, setExpanded] = useState(true);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: projects = [] } = trpc.projects.list.useQuery();

  if (projects.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-7 py-2 text-[0.92rem] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRightIcon className={cn("size-3.5 transition-transform", expanded && "rotate-90")} />
        Projects
      </button>
      {expanded && (
        <div className="mt-1 flex flex-col gap-1">
          {projects.map((p) => {
            const href = `/leads?project=${p.id}`;
            const active =
              pathname === "/leads" && searchParams.get("project") === p.id;
            return (
              <Button
                key={p.id}
                render={<Link href={href} onClick={onNav} />}
                variant="ghost"
                className={cn(
                  "h-11 w-full justify-start gap-2.5 rounded-2xl px-10 text-[0.96rem] font-normal text-muted-foreground hover:bg-accent/70 hover:text-foreground",
                  active && "bg-accent text-foreground font-medium",
                )}
              >
                <FolderIcon className="size-4 shrink-0" />
                <span className="truncate">{p.name}</span>
                {p.leadCount !== undefined && (
                  <span className="ml-auto text-[0.92rem] text-muted-foreground/70">{p.leadCount}</span>
                )}
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NavContent({ onNav }: { onNav?: () => void }) {
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
          <ProjectsList onNav={onNav} />
        </div>
      </nav>

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

export function MobileHeader() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Top bar — mobile only */}
      <header className="flex h-[74px] shrink-0 items-center border-b bg-background px-4 md:hidden">
        <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Open menu">
          <MenuIcon className="size-5" />
        </Button>
        <span className="ml-3 text-[1.1rem] font-semibold tracking-tight">Dashboard</span>
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
          "fixed inset-y-0 left-0 z-50 flex w-[305px] flex-col bg-background shadow-xl transition-transform duration-200 md:hidden",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-[74px] items-center justify-between border-b px-7">
          <span className="text-[1.1rem] font-semibold tracking-tight">Dashboard</span>
          <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close menu">
            <XIcon className="size-4" />
          </Button>
        </div>
        <NavContent onNav={() => setOpen(false)} />
      </div>
    </>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden h-screen w-[305px] shrink-0 flex-col border-r bg-background md:flex">
      <div className="flex h-[74px] items-center px-7 shrink-0">
        <span className="text-[1.1rem] font-semibold tracking-tight">Dashboard</span>
      </div>

      <Separator />

      <NavContent />
    </aside>
  );
}
