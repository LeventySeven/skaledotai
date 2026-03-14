"use client";

import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import {
  X_DATA_PROVIDER_OPTIONS,
  type XDataProvider,
} from "@/lib/x";
import { useXDataProviderPreference } from "./XDataProviderPreference";

export function XDataProviderSelector({
  className,
}: {
  className?: string;
}) {
  const { provider, setProvider } = useXDataProviderPreference();
  const { data: runtimeStatuses = [] } = trpc.settings.xProviders.list.useQuery();
  const statusByProvider = new Map(runtimeStatuses.map((status) => [status.provider, status]));

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
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
              "rounded-full border px-3 py-1 text-[0.83rem] transition-colors",
              active
                ? "border-foreground/20 bg-foreground text-background"
                : "border-border bg-background text-muted-foreground hover:border-foreground/20 hover:text-foreground",
              disabled && "cursor-not-allowed opacity-40",
            )}
            aria-pressed={active}
            disabled={disabled}
          >
            {option.label}
            {disabled ? " (not configured)" : null}
          </button>
        );
      })}
    </div>
  );
}
