"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SearchIcon, UsersIcon, SendIcon, SettingsIcon, MenuIcon, XIcon, FolderIcon, ChevronRightIcon, LogOutIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipPopup } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Project } from "@/lib/types";
import { signOutAction } from "@/app/(auth)/actions";

const navItems = [
  { href: "/search", label: "Search", icon: SearchIcon },
  { href: "/leads", label: "Leads", icon: UsersIcon },
  { href: "/outreach", label: "Outreach", icon: SendIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

function ProjectsList({ onNav }: { onNav?: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [expanded, setExpanded] = useState(true);
  const pathname = usePathname();

  useEffect(() => {
    // TODO: replace with tRPC query
  }, [pathname]);

  if (projects.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRightIcon className={cn("size-3 transition-transform", expanded && "rotate-90")} />
        Projects
      </button>
      {expanded && (
        <div className="mt-0.5 flex flex-col gap-0.5">
          {projects.map((p) => {
            const href = `/leads?project=${p.id}`;
            const active = pathname === "/leads" && typeof window !== "undefined" && window.location.search.includes(p.id);
            return (
              <Button
                key={p.id}
                render={<Link href={href} onClick={onNav} />}
                variant="ghost"
                className={cn(
                  "w-full justify-start gap-2 px-3 pl-7 text-xs font-normal text-muted-foreground hover:text-foreground h-7",
                  active && "bg-accent text-foreground font-medium",
                )}
              >
                <FolderIcon className="size-3 shrink-0" />
                <span className="truncate">{p.name}</span>
                {p.leadCount !== undefined && (
                  <span className="ml-auto text-[10px] text-muted-foreground/60">{p.leadCount}</span>
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
    <>
      <div className="flex h-14 items-center px-5">
        <span className="text-sm font-semibold tracking-tight">Dashboard</span>
      </div>
      <Separator />
      <nav className="flex flex-col gap-0.5 p-2 pt-3">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href === "/leads" && pathname === "/leads" && !pathname.includes("?"));
          return (
            <Button
              key={href}
              render={<Link href={href} onClick={onNav} />}
              variant="ghost"
              className={cn(
                "w-full justify-start gap-2.5 px-3 text-sm font-normal text-muted-foreground hover:text-foreground",
                active && "bg-accent text-foreground font-medium",
              )}
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </Button>
          );
        })}
        <ProjectsList onNav={onNav} />
      </nav>
    </>
  );
}

export function MobileHeader() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Top bar — mobile only */}
      <header className="flex h-14 shrink-0 items-center border-b bg-background px-4 md:hidden">
        <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Open menu">
          <MenuIcon className="size-5" />
        </Button>
        <span className="ml-3 text-sm font-semibold tracking-tight">Dashboard</span>
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
          "fixed inset-y-0 left-0 z-50 w-[220px] bg-background shadow-xl transition-transform duration-200 md:hidden",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-14 items-center justify-between px-5 border-b">
          <span className="text-sm font-semibold tracking-tight">Dashboard</span>
          <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close menu">
            <XIcon className="size-4" />
          </Button>
        </div>
        <nav className="flex flex-col gap-0.5 p-2 pt-3">
          <NavContent onNav={() => setOpen(false)} />
        </nav>
      </div>
    </>
  );
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <TooltipProvider>
      <aside className="hidden md:flex h-screen w-[220px] shrink-0 flex-col border-r bg-background overflow-y-auto">
        <div className="flex h-14 items-center px-5 shrink-0">
          <span className="text-sm font-semibold tracking-tight">Dashboard</span>
        </div>

        <Separator />

        <nav className="flex flex-col gap-0.5 p-2 pt-3">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <Tooltip key={href}>
                <TooltipTrigger render={<span />}>
                  <Button
                    render={<Link href={href} />}
                    variant="ghost"
                    className={cn(
                      "w-full justify-start gap-2.5 px-3 text-sm font-normal text-muted-foreground hover:text-foreground",
                      active && "bg-accent text-foreground font-medium",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    {label}
                  </Button>
                </TooltipTrigger>
                <TooltipPopup side="right" sideOffset={8}>
                  {label}
                </TooltipPopup>
              </Tooltip>
            );
          })}
            <ProjectsList />
        </nav>

        <div className="mt-auto p-2 border-t">
          <form action={signOutAction}>
            <button
              type="submit"
              className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-accent"
            >
              <LogOutIcon className="size-4 shrink-0" />
              Sign out
            </button>
          </form>
        </div>
      </aside>
    </TooltipProvider>
  );
}
