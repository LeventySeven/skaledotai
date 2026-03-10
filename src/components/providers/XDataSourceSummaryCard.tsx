"use client";

import Link from "next/link";
import { ArrowUpRightIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  getXDataProviderOption,
  X_DATA_PROVIDER_SURFACES,
  type XDataProvider,
} from "@/lib/x-provider";
import { useXDataProviderPreference } from "./XDataProviderPreference";

export function XDataSourceSummaryCard({
  className,
  compact = false,
  provider: providerOverride,
  showButton = true,
}: {
  className?: string;
  compact?: boolean;
  provider?: XDataProvider;
  showButton?: boolean;
}) {
  const preference = useXDataProviderPreference();
  const provider = providerOverride ?? preference.provider;
  const option = getXDataProviderOption(provider);

  return (
    <div
      className={cn(
        "rounded-[24px] border border-border bg-card p-4 shadow-xs/5",
        compact && "rounded-[20px] p-3.5",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge size="sm" variant="outline">
              Global
            </Badge>
            <Badge size="sm" variant="secondary">
              {option.badge}
            </Badge>
          </div>
          <div className={cn("mt-3 text-[1.15rem] font-semibold tracking-[-0.02em]", compact && "text-[1.02rem]")}>
            {option.label}
          </div>
          <p className={cn("mt-1 text-sm leading-6 text-muted-foreground", compact && "text-[0.82rem] leading-5")}>
            {option.description}
          </p>
        </div>

        {showButton ? (
          <Button
            render={<Link href="/settings/x-data-source" />}
            variant="outline"
            size="sm"
            className="shrink-0 rounded-xl"
          >
            Manage
            <ArrowUpRightIcon className="size-4" />
          </Button>
        ) : null}
      </div>

      <p className={cn("mt-3 text-xs leading-5 text-muted-foreground", compact && "mt-2")}>
        {option.integration}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {X_DATA_PROVIDER_SURFACES.map((surface) => (
          <Badge key={surface} size="sm" variant="outline">
            {surface}
          </Badge>
        ))}
      </div>
    </div>
  );
}
