"use client";

import { CheckIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import {
  X_DATA_PROVIDER_OPTIONS,
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
    <div className={cn("grid gap-4 sm:grid-cols-3", className)}>
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
              "relative rounded-[1.25rem] border p-5 text-left transition-colors",
              active
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card text-foreground hover:border-foreground/30",
              disabled && "cursor-not-allowed opacity-50",
            )}
            aria-pressed={active}
            disabled={disabled}
          >
            {active ? (
              <span className="absolute right-4 top-4 inline-flex size-5 items-center justify-center rounded-full bg-background/15">
                <CheckIcon className="size-3 text-background" />
              </span>
            ) : null}

            <div className="flex items-center gap-2">
              <span className="text-[1.05rem] font-semibold">{option.label}</span>
              <Badge
                size="sm"
                variant={active ? "secondary" : "outline"}
                className={cn(active && "bg-background/12 text-background")}
              >
                {disabled ? "Not configured" : option.badge}
              </Badge>
            </div>

            <p className={cn(
              "mt-2 text-[0.85rem] leading-5",
              active ? "text-background/70" : "text-muted-foreground",
            )}>
              {option.description}
            </p>

            {disabled && status?.missingEnv.length ? (
              <p className={cn(
                "mt-3 text-xs",
                active ? "text-background/60" : "text-muted-foreground/70",
              )}>
                Missing: {status.missingEnv.join(", ")}
              </p>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
