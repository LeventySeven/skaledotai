"use client";

import { CheckCircle2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LangGraphIcon } from "@/components/ui/langgraph-icon";
import { XLogoIcon } from "@/components/ui/x-icon";
import { cn } from "@/lib/utils";
import {
  X_DATA_PROVIDER_OPTIONS,
  type XDataProvider,
} from "@/lib/x";
import { useXDataProviderPreference } from "./XDataProviderPreference";

export function XDataSourceSummaryCard({
  className,
}: {
  className?: string;
}) {
  const { provider, setProvider } = useXDataProviderPreference();

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {X_DATA_PROVIDER_OPTIONS.filter((o) => o.value === "x-api" || o.value === "multiagent").map((option) => {
        const active = provider === option.value;

        return (
          <Button
            key={option.value}
            variant="outline"
            className={cn(
              "rounded-[10px] px-3 py-2 text-[0.85rem] font-semibold",
              active
                ? "border-emerald-500 bg-card"
                : "border-border/70 bg-card text-muted-foreground hover:border-foreground/20",
            )}
            onClick={() => setProvider(option.value as XDataProvider)}
          >
            {option.value === "x-api" ? <><XLogoIcon className="size-3.5" /> API</> : null}
            {option.value === "multiagent" ? <><LangGraphIcon className="size-5" /> {option.label}</> : null}
            {active ? <CheckCircle2Icon className="size-3.5 text-emerald-500" /> : null}
          </Button>
        );
      })}
    </div>
  );
}
