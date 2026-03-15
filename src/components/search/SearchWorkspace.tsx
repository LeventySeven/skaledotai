"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

export function SearchWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // If rerun params are present, redirect straight to /search/refine
  const hasRerunParams = searchParams.has("project") || searchParams.has("importUsername");
  useEffect(() => {
    if (hasRerunParams) {
      router.replace(`/search/refine?${searchParams.toString()}`);
    }
  }, [hasRerunParams, searchParams, router]);

  const [query, setQuery] = useState("");
  const [searchFollowersOnly, setSearchFollowersOnly] = useState(false);
  const [followerUsername, setFollowerUsername] = useState("");

  function handleContinue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query.trim()) return;

    const params = new URLSearchParams({ query: query.trim() });
    if (searchFollowersOnly && followerUsername.trim()) {
      const cleanHandle = followerUsername
        .trim()
        .replace(/^https?:\/\/(www\.)?(x\.com|twitter\.com)\//i, "")
        .replace(/^@/, "")
        .replace(/\/.*$/, "")
        .trim();
      if (cleanHandle) {
        params.set("followerUsername", cleanHandle);
      }
    }
    router.push(`/search/refine?${params.toString()}`);
  }

  if (hasRerunParams) return null;

  return (
    <div className="mx-auto flex min-h-[calc(100vh-64px)] max-w-[736px] flex-col items-center justify-center px-8">
      <div className="w-full space-y-8">
        <div className="text-center">
          <h1 className="text-[32px] font-medium">
            Describe your goal or audience
          </h1>
        </div>

        <form className="space-y-5" onSubmit={handleContinue}>
          <div className="relative">
            <Input
              className="h-[48px] items-center rounded-[12px] pr-12 text-[1.05rem]"
              placeholder="e.g. best product designers"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              required
              autoFocus
            />
            <Button
              type="submit"
              size="icon-bare"
              className="absolute top-1/2 right-2.5 size-8 -translate-y-1/2 rounded-[8px] bg-foreground text-background hover:bg-foreground/90"
            >
              <ArrowRightIcon className="size-4" />
            </Button>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-3 text-[0.95rem]">
              <Checkbox
                checked={searchFollowersOnly}
                onCheckedChange={(value) => setSearchFollowersOnly(Boolean(value))}
              />
              Search within a user&apos;s followers
            </label>
            {searchFollowersOnly ? (
              <Input
                className="h-[42px] items-center rounded-[10px] text-[1rem]"
                placeholder="@markknd"
                value={followerUsername}
                onChange={(event) => setFollowerUsername(event.target.value)}
              />
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}
