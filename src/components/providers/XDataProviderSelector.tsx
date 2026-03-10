"use client";

import { cn } from "@/lib/utils";
import {
  getXDataProviderLabel,
  X_DATA_PROVIDER_OPTIONS,
  type XDataProvider,
} from "@/lib/x-provider";
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

  return (
    <div className={cn("space-y-3", className)}>
      {showHint ? (
        <p className={cn("text-sm text-muted-foreground", compact && "text-xs")}>
          Uses <span className="font-medium text-foreground">{getXDataProviderLabel(provider)}</span> for search, imports,
          stats, and AI analysis.
        </p>
      ) : null}

      <div className={cn("grid gap-2", compact ? "grid-cols-1" : "sm:grid-cols-3")}>
        {X_DATA_PROVIDER_OPTIONS.map((option) => (
          <ProviderButton
            key={option.value}
            active={provider === option.value}
            option={option}
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
  onSelect,
}: {
  active: boolean;
  option: {
    value: XDataProvider;
    label: string;
    description: string;
  };
  onSelect: (provider: XDataProvider) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(option.value)}
      className={cn(
        "rounded-[18px] border px-4 py-3 text-left transition-colors",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-input bg-background text-foreground hover:bg-accent/50",
      )}
      aria-pressed={active}
    >
      <div className="text-[0.98rem] font-semibold">{option.label}</div>
      <div className={cn("mt-1 text-xs leading-5", active ? "text-background/78" : "text-muted-foreground")}>
        {option.description}
      </div>
    </button>
  );
}

