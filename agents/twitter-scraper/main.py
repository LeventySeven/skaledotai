"""Autonomous Twitter lead scraper — runs forever until Ctrl+C.

Pipeline: each strategy gets 3 rounds, then next. After all done, repeat.

  1. Twitter People Search (×3)
  2. Twitter Recommended / "You Might Like" (×3)
  3. Verified Followers/Following Crawl (×3)
  4. Twitter Feed Scrolling (×3)
  5. Web Search — DuckDuckGo (×3)
  6. Google Dork Search (×3)
  7. Twitter Latest + Combo (×2 bonus)

Only collects: real individual people, 5k-200k followers. No companies.
Rules for rejection are in rules.py — expand them when cleaning datasets.
"""

from __future__ import annotations

import asyncio
import json
import os
import random
import signal
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

_project_root = Path(__file__).resolve().parent.parent.parent
load_dotenv(_project_root / ".env")

from agents import Agent, Runner, RunConfig, RunHooks, RunContextWrapper
from agents.exceptions import MaxTurnsExceeded
from agents.tool import Tool

from config import load_config, ScraperConfig
from tools import ScraperContext, create_context, cleanup_context
from agent import scraper_agent


ROUNDS_PER_STRATEGY = 3
SCROLL_INSTRUCTION = "Scroll at least 10-15 times with scroll_and_extract_more() — the more you scroll, the more new people appear. Don't stop early."
FILTER_INSTRUCTION = """ONLY save real individual people with 5,000-200,000 followers.
Skip companies, brands, products, frameworks, news accounts, anyone over 200k.
If the name or bio looks like a company — skip it."""


class StrategyRotator:
    def __init__(self, config: ScraperConfig):
        self.config = config
        self._twitter_idx = 0
        self._dork_role_idx = 0
        self._dork_template_idx = 0
        self._modifier_idx = 0
        self._combo_idx = 0
        self._network_idx = 0
        self._feed_idx = 0

        self._internal_leads = self._load_internal_leads()

        # Build strategy pipeline: each strategy × N rounds
        self._strategies = []
        for _ in range(ROUNDS_PER_STRATEGY):
            self._strategies.append(("twitter_search", self._twitter_people))
        for _ in range(ROUNDS_PER_STRATEGY):
            self._strategies.append(("recommended", self._you_might_like))
        for _ in range(ROUNDS_PER_STRATEGY):
            self._strategies.append(("network_crawl", self._network_crawl))
        for _ in range(ROUNDS_PER_STRATEGY):
            self._strategies.append(("feed_scroll", self._feed_scroll))
        for _ in range(ROUNDS_PER_STRATEGY):
            self._strategies.append(("web_search", self._web_search))
        for _ in range(ROUNDS_PER_STRATEGY):
            self._strategies.append(("google_dork", self._google_dork))
        # Bonus
        self._strategies.append(("twitter_latest", self._twitter_latest))
        self._strategies.append(("twitter_latest", self._twitter_latest))
        self._strategies.append(("combo", self._combo))

        self._strat_idx = 0
        random.shuffle(self.config.twitter_search_queries)
        random.shuffle(self.config.google_dork_roles)
        random.shuffle(self._internal_leads)

    def _load_internal_leads(self) -> list[str]:
        import glob as g
        handles = []
        for fp in g.glob(os.path.join(self.config.output_dir, "internal-leads-*.json")):
            try:
                with open(fp) as f:
                    data = json.load(f)
                for e in data:
                    h = e.get("handle", "").strip()
                    fol = e.get("followers", 0)
                    if h and 5000 <= fol <= 200000:
                        handles.append(h)
            except Exception:
                continue
        print(f"  [Rotator] {len(handles)} internal lead handles as seeds")
        return handles

    def _pick_seed(self) -> str:
        if self._internal_leads:
            h = self._internal_leads[self._network_idx % len(self._internal_leads)]
            self._network_idx += 1
            return h
        return "levelsio"

    def next_mission(self) -> tuple[str, str]:
        name, fn = self._strategies[self._strat_idx % len(self._strategies)]
        self._strat_idx += 1
        return (name, fn())

    # ── 1. Twitter People Search ──────────────────────────────────────────

    def _twitter_people(self) -> str:
        q = self.config.twitter_search_queries[self._twitter_idx % len(self.config.twitter_search_queries)]
        self._twitter_idx += 1
        return f"""MISSION: Twitter People Search — "{q}"

1. search_twitter_people("{q}")
2. For EVERY result: check_if_known → scrape_profile → save if 5k-200k followers
3. {SCROLL_INSTRUCTION}
4. For each saved lead, call scrape_you_might_like() to chain into similar people
5. flush_leads_to_file()

{FILTER_INSTRUCTION}"""

    # ── 2. Recommended / "You Might Like" ─────────────────────────────────

    def _you_might_like(self) -> str:
        seed = self._pick_seed()
        return f"""MISSION: "You Might Like" Chain — @{seed}

@{seed} is a known lead. Twitter recommends similar people in the sidebar.

1. scrape_you_might_like("{seed}") — get sidebar suggestions
2. For EACH suggestion: check_if_known → scrape_profile → save if 5k-200k
3. Then scrape_you_might_like() on EACH saved lead to go deeper
4. Chain at least 4 levels: seed → suggestions → their suggestions → deeper
5. {SCROLL_INSTRUCTION}
6. flush_leads_to_file()

{FILTER_INSTRUCTION}"""

    # ── 3. Verified Followers/Following Crawl ─────────────────────────────

    def _network_crawl(self) -> str:
        seed = self._pick_seed()
        do_followers = (self._network_idx % 2 == 0)
        direction = "followers" if do_followers else "following"
        fn = "browse_followers_of" if do_followers else "browse_following_of"
        return f"""MISSION: Crawl verified {direction} of @{seed}

@{seed} is a known lead. Their {direction} contain similar professionals.

1. scrape_you_might_like("{seed}") — grab sidebar suggestions first
2. {fn}("{seed}") — browse the full {direction} list
3. {SCROLL_INSTRUCTION}
4. For EVERY account with 5k-200k followers: check_if_known → scrape_profile → save
5. For the best finds, scrape_you_might_like() on them too
6. Keep scrolling and processing — get as many as possible from this one page
7. flush_leads_to_file()

Use a DIFFERENT lead each time. Try to scroll deep — 8-10 times minimum.
{FILTER_INSTRUCTION}"""

    # ── 4. Twitter Feed Scrolling ─────────────────────────────────────────

    def _feed_scroll(self) -> str:
        tabs = ["for_you", "trending", "tech"]
        tab = tabs[self._feed_idx % len(tabs)]
        self._feed_idx += 1
        return f"""MISSION: Scroll Twitter Feed — {tab}

Just scroll through Twitter and find interesting people.

1. browse_twitter_explore("{tab}")
2. {SCROLL_INSTRUCTION}
3. Look at who's posting — find real individual people (not brands/news)
4. For each interesting handle: check_if_known → scrape_profile → save if 5k-200k
5. For saved leads, scrape_you_might_like() to find similar people
6. Keep scrolling — the more you scroll, the more new people appear
7. flush_leads_to_file()

{FILTER_INSTRUCTION}"""

    # ── 5. Web Search (DuckDuckGo) ────────────────────────────────────────

    def _web_search(self) -> str:
        role = self.config.google_dork_roles[self._dork_role_idx % len(self.config.google_dork_roles)]
        self._dork_role_idx += 1
        return f"""MISSION: Web Search — {role}

1. web_search_profiles('site:x.com "{role}" bio followers')
2. Extract handles → check_if_known → scrape_profile → save if 5k-200k
3. Also try: web_search_profiles("best {role}s to follow twitter 2025")
4. {SCROLL_INSTRUCTION}
5. scrape_you_might_like() on saved leads
6. flush_leads_to_file()

{FILTER_INSTRUCTION}"""

    # ── 6. Google Dork Search ─────────────────────────────────────────────

    def _google_dork(self) -> str:
        templates = self.config.google_dork_templates
        roles = self.config.google_dork_roles
        t = templates[self._dork_template_idx % len(templates)]
        r = roles[self._dork_role_idx % len(roles)]
        self._dork_template_idx += 1
        self._dork_role_idx += 1
        dork = t.replace("{role}", r)
        return f"""MISSION: Google Dork — {r}

1. google_dork_search("{dork}")
2. For each Twitter link: extract_twitter_handle_from_url → check_if_known → scrape_profile
3. Save if 5k-200k and real person
4. If Google captcha: switch to web_search_profiles('site:x.com "{r}" followers')
5. scrape_you_might_like() on saved leads
6. flush_leads_to_file()

{FILTER_INSTRUCTION}"""

    # ── Bonus: Twitter Latest ─────────────────────────────────────────────

    def _twitter_latest(self) -> str:
        q = self.config.twitter_search_queries[self._twitter_idx % len(self.config.twitter_search_queries)]
        m = self.config.search_modifiers[self._modifier_idx % len(self.config.search_modifiers)]
        self._twitter_idx += 1
        self._modifier_idx += 1
        return f"""MISSION: Twitter Latest — "{q} {m}"

1. twitter_search_latest("{q} {m}")
2. For each author: check_if_known → scrape_profile → save if 5k-200k
3. {SCROLL_INSTRUCTION}
4. scrape_you_might_like() on saved leads
5. flush_leads_to_file()

{FILTER_INSTRUCTION}"""

    # ── Bonus: Combo ──────────────────────────────────────────────────────

    def _combo(self) -> str:
        qs = self.config.twitter_search_queries
        q1 = qs[self._combo_idx % len(qs)]
        q2 = qs[(self._combo_idx + 5) % len(qs)]
        self._combo_idx += 1
        return f"""MISSION: Multi-Search

Try multiple approaches:
A: search_twitter_people("{q1}")
B: twitter_search_latest("{q2}")
C: Invent your own creative query

For each: check_if_known → scrape_profile → save if 5k-200k.
{SCROLL_INSTRUCTION}
scrape_you_might_like() on best finds.
flush_leads_to_file()

{FILTER_INSTRUCTION}"""


# ── Hooks ────────────────────────────────────────────────────────────────────


class ScraperHooks(RunHooks[ScraperContext]):
    def __init__(self):
        self.start_time = time.time()
        self.tool_calls = 0
        self.cycle_tool_calls = 0

    def _elapsed(self) -> str:
        s = int(time.time() - self.start_time)
        h, m, sec = s // 3600, (s % 3600) // 60, s % 60
        return f"{h}h{m:02d}m{sec:02d}s" if h else f"{m}m{sec:02d}s"

    def reset_cycle(self):
        self.cycle_tool_calls = 0

    async def on_tool_start(self, ctx, agent, tool):
        self.tool_calls += 1
        self.cycle_tool_calls += 1

    async def on_tool_end(self, ctx, agent, tool, result):
        if tool.name in ("save_lead", "flush_leads_to_file"):
            print(f"  [{self._elapsed()}] {tool.name}: {result[:140]}")


# ── Main ─────────────────────────────────────────────────────────────────────


async def main() -> None:
    config = load_config()

    print("\n" + "=" * 60)
    print("  Twitter Lead Scraper — High Relevancy Only")
    print("  5k-200k followers | Real people only | No companies")
    print("  Ctrl+C to stop (auto-saves)")
    print("=" * 60)
    print(f"  CDP: {config.cdp_url}")
    print(f"  Output: {config.output_dir}")
    print(f"  Queries: {len(config.twitter_search_queries)}")
    print(f"  Dork roles: {len(config.google_dork_roles)}")
    print(f"  Cycle pause: {config.cycle_pause}s")
    print("=" * 60 + "\n")

    print("  Connecting to Chrome...")
    ctx = await create_context(config)

    _shutting_down = False
    def shutdown(sig, frame):
        nonlocal _shutting_down
        if _shutting_down:
            sys.exit(1)
        _shutting_down = True
        print("\n\n  [!] Saving leads...")
        ctx.store.flush()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    rotator = StrategyRotator(config)
    hooks = ScraperHooks()
    cycle = 0

    print("  Starting...\n")

    while True:
        cycle += 1
        name, mission = rotator.next_mission()
        counts = ctx.store.counts()
        hooks.reset_cycle()

        rnd = ((rotator._strat_idx - 1) % len(rotator._strategies)) + 1

        print(f"\n{'─' * 60}")
        print(f"  CYCLE {cycle} | {name} | {rnd}/{len(rotator._strategies)} | {hooks._elapsed()}")
        print(f"  Leads: {counts['total']} | Tools: {hooks.tool_calls}")
        print(f"{'─' * 60}\n")

        try:
            result = Runner.run_streamed(
                starting_agent=scraper_agent,
                input=mission,
                context=ctx,
                max_turns=200,
                hooks=hooks,
                run_config=RunConfig(tracing_disabled=True),
            )
            async for _ in result.stream_events():
                pass

            new = ctx.store.counts()["total"] - counts["total"]
            print(f"\n  +{new} leads | {hooks.cycle_tool_calls} tools")
            if result.final_output:
                print(f"  Agent: {str(result.final_output)[:250]}")

        except MaxTurnsExceeded:
            print(f"\n  Hit turn limit — next strategy")
            ctx.store.flush()
            ctx.mark_flushed()
        except Exception as e:
            print(f"\n  [ERROR] {e}")
            ctx.store.flush()
            ctx.mark_flushed()
            await asyncio.sleep(5)

        print(f"  Pause {config.cycle_pause}s...")
        await asyncio.sleep(config.cycle_pause)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except SystemExit:
        pass
