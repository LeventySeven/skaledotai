"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Drop-in banner to show when a user hits a plan limit. */
export function UpgradePrompt({ message }: { message?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
      <p className="flex-1 text-sm text-foreground">
        {message ?? "You've reached your plan limit."}
      </p>
      <Button size="sm" render={<Link href="/pricing" />}>
        Upgrade
      </Button>
    </div>
  );
}
