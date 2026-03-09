"use client";

import { SearchForm } from "./SearchForm";
import { ImportNetworkForm } from "./ImportNetworkForm";

export function SearchWorkspace() {
  return (
    <div className="mx-auto max-w-[1120px] px-8 py-6">
      <div className="max-w-[760px]">
        <h1 className="text-[2.85rem] font-semibold tracking-[-0.04em]">Search</h1>
        <p className="mt-2 text-[1rem] text-muted-foreground">
          Find people in any niche on X/Twitter.
        </p>

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
