"use client";

import Link from "next/link";
import { CheckCircle2Icon } from "lucide-react";
import { LangGraphIcon } from "@/components/ui/langgraph-icon";
import { XLogoIcon } from "@/components/ui/x-icon";
import { cn } from "@/lib/utils";
import {
  X_DATA_PROVIDER_OPTIONS,
} from "@/lib/x";
import { useXDataProviderPreference } from "./XDataProviderPreference";

export function XDataSourceSummaryCard({
  className,
}: {
  className?: string;
}) {
  const { provider } = useXDataProviderPreference();

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {X_DATA_PROVIDER_OPTIONS.filter((o) => o.value === "x-api" || o.value === "multiagent").map((option) => {
        const active = provider === option.value;

        return (
          <Link
            key={option.value}
            href="/settings"
            className={cn(
              "flex items-center gap-1.5 rounded-[10px] border px-3 py-2 text-[0.85rem] font-semibold shadow-sm transition-colors",
              active
                ? "border-[#e43420] bg-card"
                : "border-border/70 bg-card text-muted-foreground hover:border-foreground/20",
            )}
          >
            {option.value === "x-api" ? <><XLogoIcon className="size-3.5" /> API</> : null}
            {option.value === "multiagent" ? <><LangGraphIcon className="size-5" /> {option.label}</> : null}
            {active ? <CheckCircle2Icon className="size-3.5 text-[#e43420]" /> : null}
          </Link>
        );
      })}
    </div>
  );
}
