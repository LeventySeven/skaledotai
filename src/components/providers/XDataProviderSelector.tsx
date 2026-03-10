"use client";

import { CheckIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import {
  getXDataProviderLabel,
  X_DATA_PROVIDER_OPTIONS,
  type XDataProvider,
} from "@/lib/x";
import { useXDataProviderPreference } from "./XDataProviderPreference";

export function XDataProviderSelector({
  className,
  compact = false,
  showHint = true,
}: {
  className?: string;
  compact?: boolean;
  showHint?: boolean;
}) {
  const { provider, setProvider } = useXDataProviderPreference();
  const { data: runtimeStatuses = [] } = trpc.settings.xProviders.list.useQuery();
  const statusByProvider = new Map(runtimeStatuses.map((status) => [status.provider, status]));

  return (
    <div className={cn("space-y-3", className)}>
      {showHint ? (
        <p className={cn("text-sm text-muted-foreground", compact && "text-xs")}>
          Uses <span className="font-medium text-foreground">{getXDataProviderLabel(provider)}</span> for search, imports,
          stats, and AI analysis.
        </p>
      ) : null}

      <div className={cn("space-y-2", compact && "space-y-1.5")}>
        {X_DATA_PROVIDER_OPTIONS.map((option) => (
          <ProviderButton
            key={option.value}
            active={provider === option.value}
            option={option}
            runtimeStatus={statusByProvider.get(option.value)}
            onSelect={setProvider}
          />
        ))}
      </div>
    </div>
  );
}

function ProviderButton({
  active,
  option,
  runtimeStatus,
  onSelect,
}: {
  active: boolean;
  option: {
    value: XDataProvider;
    label: string;
    badge: string;
    description: string;
    integration: string;
    experimental?: boolean;
  };
  runtimeStatus?: {
    configured: boolean;
    missingEnv: string[];
    capabilityNote: string;
  };
  onSelect: (provider: XDataProvider) => void;
}) {
  const disabled = runtimeStatus ? !runtimeStatus.configured : false;

  return (
    <button
      type="button"
      onClick={() => {
        if (!disabled) onSelect(option.value);
      }}
      className={cn(
        "flex w-full items-start gap-3 rounded-[22px] border px-4 py-4 text-left transition-colors",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-input bg-background text-foreground hover:bg-accent/50",
        disabled && "cursor-not-allowed opacity-60 hover:bg-background",
      )}
      aria-pressed={active}
      disabled={disabled}
    >
      <span
        className={cn(
          "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border",
          active
            ? "border-background/70 bg-background/12 text-background"
            : "border-input text-transparent",
        )}
      >
        <CheckIcon className="size-3.5" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[1rem] font-semibold">{option.label}</span>
          <Badge
            size="sm"
            variant={active ? "secondary" : "outline"}
            className={cn(active && "bg-background/12 text-background")}
          >
            {disabled ? "Not configured" : option.badge}
          </Badge>
          {option.experimental ? (
            <Badge
              size="sm"
              variant={active ? "secondary" : "outline"}
              className={cn(active && "bg-background/12 text-background")}
            >
              Experimental
            </Badge>
          ) : null}
        </span>
        <span className={cn("mt-1 block text-sm leading-6", active ? "text-background/78" : "text-muted-foreground")}>
          {option.description}
        </span>
        <span className={cn("mt-2 block text-xs leading-5", active ? "text-background/68" : "text-muted-foreground/80")}>
          {runtimeStatus?.capabilityNote ?? option.integration}
        </span>
        {disabled && runtimeStatus?.missingEnv.length ? (
          <span className={cn("mt-2 block text-xs leading-5", active ? "text-background/68" : "text-muted-foreground/80")}>
            Missing: {runtimeStatus.missingEnv.join(", ")}
          </span>
        ) : (
          <span className={cn("mt-2 block text-xs leading-5", active ? "text-background/68" : "text-muted-foreground/80")}>
            {option.integration}
          </span>
        )}
      </span>
      <div
        className={cn(
          "mt-1 hidden text-xs font-medium md:block",
          active ? "text-background/78" : "text-muted-foreground",
        )}
      >
        {active ? "Selected" : "Select"}
      </div>
    </button>
  );
}
