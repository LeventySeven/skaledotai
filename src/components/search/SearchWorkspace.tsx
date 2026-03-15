"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRightIcon, CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

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
  const [platform, setPlatform] = useState<"x" | "linkedin">("x");

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
      <div className="w-full">
        <h1 className="mb-8 text-center text-[32px] font-medium">
          Describe your goal or audience
        </h1>

        <form onSubmit={handleContinue}>
          <div className="flex h-[64px] items-center rounded-[100px] border border-[#dddddd] bg-[#f8f8f8] pr-3 pl-[29px]">
            <input
              className="min-w-0 flex-1 bg-transparent text-[18px] font-normal outline-none placeholder:text-[#999999]"
              placeholder="For eg: I want to promote a launch video for my AI product..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              required
              autoFocus
            />
            <Button
              type="submit"
              size="icon-bare"
              className="ml-3 size-10 shrink-0 rounded-full bg-foreground text-background hover:bg-foreground/90"
            >
              <ArrowRightIcon className="size-4" />
            </Button>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <label className="flex items-center gap-2.5 text-[0.9rem] text-muted-foreground">
              <Checkbox
                checked={searchFollowersOnly}
                onCheckedChange={(value) => setSearchFollowersOnly(Boolean(value))}
              />
              Search within my followers
            </label>

            <div className="flex items-center gap-2">
              <span className="text-[0.9rem] text-muted-foreground">Search on</span>
              <button
                type="button"
                onClick={() => setPlatform("x")}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[0.82rem] font-medium transition-colors ${
                  platform === "x"
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background text-foreground hover:border-foreground/30"
                }`}
              >
                X / Twitter
                {platform === "x" ? <CheckIcon className="size-3" strokeWidth={3} /> : null}
              </button>
              <button
                type="button"
                onClick={() => setPlatform("linkedin")}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[0.82rem] font-medium transition-colors ${
                  platform === "linkedin"
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background text-foreground hover:border-foreground/30"
                }`}
              >
                LinkedIn
                {platform === "linkedin" ? <CheckIcon className="size-3" strokeWidth={3} /> : null}
              </button>
            </div>
          </div>

          {searchFollowersOnly ? (
            <div className="mt-4 flex h-[64px] items-center rounded-[100px] border border-[#dddddd] bg-[#f8f8f8] pr-3 pl-[29px]">
              <input
                className="min-w-0 flex-1 bg-transparent text-[18px] font-normal outline-none placeholder:text-[#999999]"
                placeholder="@markknd"
                value={followerUsername}
                onChange={(event) => setFollowerUsername(event.target.value)}
              />
            </div>
          ) : null}
        </form>
      </div>
    </div>
  );
}
