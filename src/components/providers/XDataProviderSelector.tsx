"use client";

import { CheckCircle2Icon } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { LangGraphIcon } from "@/components/ui/langgraph-icon";
import { XLogoIcon } from "@/components/ui/x-icon";
import {
  X_DATA_PROVIDER_OPTIONS,
} from "@/lib/x";
import type { XProviderRuntimeStatus } from "@/lib/x/registry";
import { useXDataProviderPreference } from "./XDataProviderPreference";

export function XDataProviderSelector({
  className,
  initialStatuses,
}: {
  className?: string;
  initialStatuses?: XProviderRuntimeStatus[];
}) {
  const { provider, setProvider } = useXDataProviderPreference();
  const { data: runtimeStatuses = [] } = trpc.settings.xProviders.list.useQuery(undefined, {
    initialData: initialStatuses,
  });
  const statusByProvider = new Map(runtimeStatuses.map((status) => [status.provider, status]));

  return (
    <div className={cn("grid grid-cols-[repeat(auto-fill,minmax(271px,1fr))] items-stretch gap-5", className)}>
      {X_DATA_PROVIDER_OPTIONS.map((option) => {
        const status = statusByProvider.get(option.value);
        const disabled = status ? !status.configured : false;
        const active = provider === option.value;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => {
              if (!disabled) setProvider(option.value);
            }}
            className={cn(
              "flex items-center justify-between rounded-[10px] border bg-card px-4 py-3 text-left shadow-sm transition-colors",
              active
                ? "border-[#e43420]"
                : "border-border/70 hover:border-foreground/20",
              disabled && "cursor-not-allowed opacity-50",
            )}
            aria-pressed={active}
            disabled={disabled}
          >
            <div className="flex items-center gap-1.5 text-[0.95rem] font-semibold">
              {option.value === "x-api" ? <><XLogoIcon className="size-3.5" /> API</> : null}
              {option.value === "multiagent" ? <><LangGraphIcon className="size-5" /> {option.label}</> : null}
              {option.value !== "x-api" && option.value !== "multiagent" ? option.label : null}
            </div>
            {active ? (
              <CheckCircle2Icon className="size-[18px] shrink-0 text-[#e43420]" />
            ) : (
              <span className="size-[18px] shrink-0 rounded-full border border-border/70" />
            )}
          </button>
        );
      })}
    </div>
  );
}
