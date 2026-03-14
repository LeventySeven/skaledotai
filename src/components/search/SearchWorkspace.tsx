"use client";

import { SearchForm } from "./SearchForm";
import { ImportNetworkForm } from "./ImportNetworkForm";

export function SearchWorkspace() {
  return (
    <div className="mx-auto max-w-[1700px] px-8 py-8">
      <div className="flex w-full items-start justify-between pb-6">
        <div className="flex flex-col">
          <div className="text-[18px] font-medium text-[#111111]/40">Find</div>
          <h1 className="text-[28px] font-medium tracking-[-0.04em]">Search</h1>
        </div>
      </div>
      <div className="-mx-8 mb-5 border-b border-border/70" />
      <div className="max-w-[760px]">
        <SearchForm />

        <div className="my-8 flex items-center gap-6 text-sm text-muted-foreground">
          <div className="h-px flex-1 bg-border" />
          <span>or</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <ImportNetworkForm />
      </div>
    </div>
  );
}
