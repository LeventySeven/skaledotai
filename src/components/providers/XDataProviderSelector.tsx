"use client";

import { CheckCircle2Icon } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
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
              "flex flex-col gap-3 rounded-[10px] border bg-card p-4 text-left shadow-sm transition-colors",
              active
                ? "border-[#e43420]"
                : "border-border/70 hover:border-foreground/20",
              disabled && "cursor-not-allowed opacity-50",
            )}
            aria-pressed={active}
            disabled={disabled}
          >
            <div className="flex items-center justify-between">
              <div className="text-[0.95rem] font-semibold">{option.label}</div>
              {active ? (
                <span className="flex size-[26px] shrink-0 items-center justify-center">
                  <CheckCircle2Icon className="size-[18px] text-[#e43420]" />
                </span>
              ) : (
                <span className="flex size-[26px] shrink-0 items-center justify-center rounded-full border border-border/70" />
              )}
            </div>

            <div className="h-px bg-border/70" />

            <div className="min-h-0 flex-1 text-[0.85rem] leading-[1.6] text-muted-foreground">
              {option.description}
            </div>

            <div className="flex items-center justify-between border-t border-border/70 pt-3 text-[0.82rem]">
              <span className="rounded-md bg-muted/60 px-2 py-0.5 text-[0.8rem] font-medium text-muted-foreground">
                {disabled ? "Not configured" : option.badge}
              </span>
              {disabled && status?.missingEnv.length ? (
                <span className="text-[0.78rem] text-muted-foreground/60">
                  Missing: {status.missingEnv.join(", ")}
                </span>
              ) : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}
