"use client";

import Link from "next/link";
import { ArrowUpRightIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LangGraphIcon } from "@/components/ui/langgraph-icon";
import { XLogoIcon } from "@/components/ui/x-icon";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import {
  getXDataProviderOption,
  X_DATA_PROVIDER_SURFACES,
  type XDataProvider,
  type XProviderCapabilities,
} from "@/lib/x";
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
  const { data: runtimeStatuses = [] } = trpc.settings.xProviders.list.useQuery();
  const status = runtimeStatuses.find((item) => item.provider === provider);

  return (
    <div
      className={cn(
        "rounded-[24px] border border-border bg-card p-4 shadow-xs/5",
        compact && "rounded-[20px] p-3",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {!compact ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge size="sm" variant="outline">
                Global
              </Badge>
              <Badge size="sm" variant="secondary">
                {status && !status.configured ? "Not configured" : option.badge}
              </Badge>
              {option.experimental ? <Badge size="sm" variant="outline">Experimental</Badge> : null}
            </div>
          ) : null}
          <div className={cn("mt-3 flex items-center gap-1.5 text-[1.15rem] font-semibold tracking-[-0.02em]", compact && "mt-0 text-[1rem]")}>
            {provider === "x-api" ? <><XLogoIcon className="size-4" /> API</> : null}
            {provider === "multiagent" ? <><LangGraphIcon className="size-[22px]" /> {option.label}</> : null}
            {provider !== "x-api" && provider !== "multiagent" ? option.label : null}
          </div>
          {!compact && (
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {option.description}
            </p>
          )}
        </div>

        {showButton ? (
          <Button
            render={<Link href="/settings" />}
            variant="outline"
            size="sm"
            className={cn("shrink-0 rounded-xl", compact && "h-8 px-3 text-[0.85rem]")}
          >
            Manage
            <ArrowUpRightIcon className="size-4" />
          </Button>
        ) : null}
      </div>

      {!compact ? (
        <>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            {status?.capabilityNote ?? option.integration}
          </p>
          {status && !status.configured && status.missingEnv.length > 0 ? (
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Missing: {status.missingEnv.join(", ")}
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            {X_DATA_PROVIDER_SURFACES.map((surface) => {
              const capabilityBySurface: Record<typeof X_DATA_PROVIDER_SURFACES[number], keyof XProviderCapabilities> = {
                Search: "discovery",
                Imports: "network",
                Stats: "tweets",
                AI: "lookup",
              };
              const supported = status ? status.capabilities[capabilityBySurface[surface]] : true;

              return (
                <Badge key={surface} size="sm" variant="outline">
                  {surface} {supported ? "Direct" : `Fallback`}
                </Badge>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
