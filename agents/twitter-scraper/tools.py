"""Function tools for the Twitter lead scraper agents.

Uses RunContextWrapper to share browser state, config, and lead store.
Multiple discovery strategies: Twitter search, Google dorks, web search,
viral quote mining, Twitter timeline browsing.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
import urllib.parse
from dataclasses import dataclass, field
from typing import Any

import agentql
from playwright.async_api import async_playwright, Browser
from agents import function_tool, RunContextWrapper

from models import LeadStore, make_lead
from config import ScraperConfig

# ── Shared Context ───────────────────────────────────────────────────────────


@dataclass
class ScraperContext:
    """Shared mutable state accessible by all tools via RunContextWrapper."""

    config: ScraperConfig
    store: LeadStore
    page: Any = None  # AgentQL-wrapped Playwright page
    browser: Browser | None = None
    _playwright: Any = None

    # Auto-flush tracking
    _last_flush_count: int = 0
    _last_flush_time: float = field(default_factory=time.time)
    auto_flush_interval: int = 30  # flush every N new leads
    auto_flush_time: int = 180  # flush every 3 min

    def should_auto_flush(self) -> bool:
        count_delta = self.store.counts()["total"] - self._last_flush_count
        time_delta = time.time() - self._last_flush_time
        return count_delta >= self.auto_flush_interval or (
            count_delta > 0 and time_delta >= self.auto_flush_time
        )

    def mark_flushed(self) -> None:
        self._last_flush_count = self.store.counts()["total"]
        self._last_flush_time = time.time()


async def create_context(config: ScraperConfig) -> ScraperContext:
    """Initialize browser, AgentQL, and lead store."""
    agentql_key = os.environ.get("AGENTQL_API_KEY")
    if agentql_key:
        agentql.configure(api_key=agentql_key)
    else:
        print("  [WARN] AGENTQL_API_KEY not set — AgentQL may not work")

    pw = await async_playwright().start()
    browser = await pw.chromium.connect_over_cdp(config.cdp_url)
    contexts = browser.contexts
    context = contexts[0] if contexts else await browser.new_context()
    raw_page = await context.new_page()
    page = await agentql.wrap_async(raw_page)
    print("  [Browser] Connected via CDP + AgentQL")

    store = LeadStore(output_dir=config.output_dir, user_id=config.user_id)

    return ScraperContext(
        config=config, store=store, page=page, browser=browser, _playwright=pw,
    )


async def cleanup_context(ctx: ScraperContext) -> None:
    for obj, method in [(ctx.page, "close"), (ctx.browser, "close"), (ctx._playwright, "stop")]:
        if obj:
            try:
                coro = getattr(obj, method)()
                if asyncio.iscoroutine(coro):
                    await coro
            except Exception:
                pass


# ── AgentQL Query Fragments ──────────────────────────────────────────────────

PEOPLE_SEARCH_QUERY = """
{
    people_results[] {
        username
        name
        bio
        followers_text
    }
}
"""

PROFILE_QUERY = """
{
    profile_info {
        display_name
        username
        bio_text
        followers_count_text
        following_count_text
    }
}
"""

GOOGLE_RESULTS_QUERY = """
{
    search_results[] {
        title
        url
        snippet
    }
}
"""

TWITTER_FEED_QUERY = """
{
    tweets[] {
        author_handle
        author_name
        tweet_text
        views_text
        likes_text
    }
}
"""

# ── Helpers ──────────────────────────────────────────────────────────────────


def _parse_count(text: str | None) -> int:
    """Parse text like '5.2K', '265.6K', '1.2M' into int."""
    if not text:
        return 0
    text = text.strip().upper().replace(",", "").replace(" ", "")
    for suffix in ["FOLLOWERS", "FOLLOWER", "FOLLOWING", "VIEWS", "LIKES", "VIEW"]:
        text = text.replace(suffix, "").strip()
    try:
        if text.endswith("K"):
            return int(float(text[:-1]) * 1_000)
        elif text.endswith("M"):
            return int(float(text[:-1]) * 1_000_000)
        elif text.endswith("B"):
            return int(float(text[:-1]) * 1_000_000_000)
        else:
            return int(float(text))
    except (ValueError, TypeError):
        return 0


async def _safe_query(page: Any, query: str, retries: int = 2) -> dict:
    """AgentQL query with retry logic."""
    for attempt in range(retries + 1):
        try:
            response = await page.query_data(query, wait_for_network_idle=True, timeout=30)
            return response if isinstance(response, dict) else {}
        except Exception as e:
            if attempt < retries:
                print(f"  [AgentQL] Retry {attempt + 1}/{retries}: {e}")
                await asyncio.sleep(3 * (attempt + 1))
            else:
                raise


def _maybe_auto_flush(ctx: ScraperContext) -> str:
    if ctx.should_auto_flush():
        filepath = ctx.store.flush()
        ctx.mark_flushed()
        return f" (auto-saved to {filepath})"
    return ""


# ═══════════════════════════════════════════════════════════════════════════════
#  STRATEGY 1: Twitter People Search
# ═══════════════════════════════════════════════════════════════════════════════


@function_tool
async def search_twitter_people(
    wrapper: RunContextWrapper[ScraperContext], query: str
) -> str:
    """Search Twitter People tab for profiles matching a query.

    Args:
        query: The search query, e.g. 'product designer' or 'startup founder'
    """
    ctx = wrapper.context
    try:
        url = f"https://x.com/search?q={urllib.parse.quote(query)}&src=typed_query&f=user"
        await ctx.page.goto(url, wait_until="domcontentloaded")
        await asyncio.sleep(ctx.config.scroll_delay)

        response = await _safe_query(ctx.page, PEOPLE_SEARCH_QUERY)
        results = response.get("people_results", [])
        if not results:
            return f"No people found for '{query}'"

        lines = [f"Found {len(results)} profiles for '{query}':"]
        for p in results:
            username = p.get("username", "?")
            name = p.get("name", "")
            bio = (p.get("bio") or "")[:100]
            followers = _parse_count(p.get("followers_text", "0"))
            lines.append(f"  @{username} | {name} | {followers} followers | {bio}")
        return "\n".join(lines)
    except Exception as e:
        return f"Error searching '{query}': {e}"


# ═══════════════════════════════════════════════════════════════════════════════
#  STRATEGY 2: Google Dork Search
# ═══════════════════════════════════════════════════════════════════════════════


@function_tool
async def google_dork_search(
    wrapper: RunContextWrapper[ScraperContext], dork_query: str
) -> str:
    """Search Google with a dork query to find Twitter profiles.
    Navigate to Google, perform the search, extract results containing x.com or twitter.com links.

    Args:
        dork_query: The full Google dork query, e.g. 'site:x.com "product designer" "followers"'
    """
    ctx = wrapper.context
    try:
        url = f"https://www.google.com/search?q={urllib.parse.quote(dork_query)}"
        await ctx.page.goto(url, wait_until="domcontentloaded")
        await asyncio.sleep(ctx.config.scroll_delay + 1)  # Google is slower

        response = await _safe_query(ctx.page, GOOGLE_RESULTS_QUERY)
        results = response.get("search_results", [])
        if not results:
            return f"No Google results for: {dork_query}"

        # Filter for Twitter/X links
        twitter_results = []
        for r in results:
            link = r.get("url", "")
            if "x.com/" in link or "twitter.com/" in link:
                twitter_results.append(r)

        if not twitter_results:
            return f"Found {len(results)} results but none were Twitter profile links"

        lines = [f"Found {len(twitter_results)} Twitter links via Google dork:"]
        for r in twitter_results:
            title = r.get("title", "")
            link = r.get("url", "")
            snippet = (r.get("snippet") or "")[:80]
            lines.append(f"  {title} | {link} | {snippet}")
        return "\n".join(lines)
    except Exception as e:
        return f"Error with Google dork '{dork_query}': {e}"


# ═══════════════════════════════════════════════════════════════════════════════
#  STRATEGY 3: Web Search (DuckDuckGo — no captcha)
# ═══════════════════════════════════════════════════════════════════════════════


@function_tool
async def web_search_profiles(
    wrapper: RunContextWrapper[ScraperContext], query: str
) -> str:
    """Search DuckDuckGo for Twitter profiles matching a description.
    Good fallback when Google blocks with captcha.

    Args:
        query: Search query, e.g. 'site:x.com "UX designer" bio followers'
    """
    ctx = wrapper.context
    try:
        url = f"https://duckduckgo.com/?q={urllib.parse.quote(query)}"
        await ctx.page.goto(url, wait_until="domcontentloaded")
        await asyncio.sleep(ctx.config.scroll_delay)

        response = await _safe_query(ctx.page, GOOGLE_RESULTS_QUERY)
        results = response.get("search_results", [])
        if not results:
            return f"No DuckDuckGo results for: {query}"

        twitter_results = [r for r in results if "x.com/" in r.get("url", "") or "twitter.com/" in r.get("url", "")]
        if not twitter_results:
            return f"Found {len(results)} results but none were Twitter links"

        lines = [f"Found {len(twitter_results)} Twitter links via web search:"]
        for r in twitter_results:
            lines.append(f"  {r.get('title', '')} | {r.get('url', '')}")
        return "\n".join(lines)
    except Exception as e:
        return f"Error web searching '{query}': {e}"


# ═══════════════════════════════════════════════════════════════════════════════
#  STRATEGY 4: Twitter Timeline / Explore Browsing
# ═══════════════════════════════════════════════════════════════════════════════


@function_tool
async def browse_twitter_explore(
    wrapper: RunContextWrapper[ScraperContext], tab: str
) -> str:
    """Browse Twitter Explore/trending tabs to find active accounts.

    Args:
        tab: Which explore tab — 'trending', 'for_you', 'tech', 'business'
    """
    ctx = wrapper.context
    try:
        tab_urls = {
            "trending": "https://x.com/explore/tabs/trending",
            "for_you": "https://x.com/explore",
            "tech": "https://x.com/explore/tabs/technology",
            "business": "https://x.com/explore/tabs/business",
        }
        url = tab_urls.get(tab, "https://x.com/explore")
        await ctx.page.goto(url, wait_until="domcontentloaded")
        await asyncio.sleep(ctx.config.scroll_delay)

        response = await _safe_query(ctx.page, TWITTER_FEED_QUERY)
        tweets = response.get("tweets", [])
        if not tweets:
            return f"No content found on explore/{tab}"

        lines = [f"Found {len(tweets)} posts on explore/{tab}:"]
        for t in tweets:
            handle = t.get("author_handle", "?")
            text = (t.get("tweet_text") or "")[:60]
            views = _parse_count(t.get("views_text", "0"))
            lines.append(f"  @{handle} | {views:,} views | {text}")
        return "\n".join(lines)
    except Exception as e:
        return f"Error browsing explore/{tab}: {e}"


# ═══════════════════════════════════════════════════════════════════════════════
#  STRATEGY 6: Creative Combo Search (agent invents its own queries)
# ═══════════════════════════════════════════════════════════════════════════════


@function_tool
async def twitter_search_latest(
    wrapper: RunContextWrapper[ScraperContext], query: str
) -> str:
    """Search Twitter Latest tab (recent tweets) for a query. Good for finding
    currently active people tweeting about a topic.

    Args:
        query: Any search query, e.g. 'founding engineer building' or 'AI researcher shipped'
    """
    ctx = wrapper.context
    try:
        url = f"https://x.com/search?q={urllib.parse.quote(query)}&src=typed_query&f=live"
        await ctx.page.goto(url, wait_until="domcontentloaded")
        await asyncio.sleep(ctx.config.scroll_delay)

        response = await _safe_query(ctx.page, TWITTER_FEED_QUERY)
        tweets = response.get("tweets", [])
        if not tweets:
            return f"No recent tweets for '{query}'"

        lines = [f"Found {len(tweets)} recent tweets for '{query}':"]
        for t in tweets:
            handle = t.get("author_handle", "?")
            text = (t.get("tweet_text") or "")[:80]
            views = _parse_count(t.get("views_text", "0"))
            likes = _parse_count(t.get("likes_text", "0"))
            lines.append(f"  @{handle} | {views:,} views | {likes:,} likes | {text}")
        return "\n".join(lines)
    except Exception as e:
        return f"Error searching latest '{query}': {e}"


@function_tool
async def browse_followers_of(
    wrapper: RunContextWrapper[ScraperContext], handle: str
) -> str:
    """Browse the followers list of a known influential account to find similar leads.

    Args:
        handle: Twitter handle to browse followers of, e.g. 'elonmusk'
    """
    ctx = wrapper.context
    clean = handle.lstrip("@").strip()
    try:
        url = f"https://x.com/{clean}/followers"
        await ctx.page.goto(url, wait_until="domcontentloaded")
        await asyncio.sleep(ctx.config.scroll_delay)

        response = await _safe_query(ctx.page, PEOPLE_SEARCH_QUERY)
        results = response.get("people_results", [])
        if not results:
            return f"Could not load followers of @{clean}"

        lines = [f"Followers of @{clean} ({len(results)} visible):"]
        for p in results:
            username = p.get("username", "?")
            name = p.get("name", "")
            bio = (p.get("bio") or "")[:80]
            followers = _parse_count(p.get("followers_text", "0"))
            lines.append(f"  @{username} | {name} | {followers} followers | {bio}")
        return "\n".join(lines)
    except Exception as e:
        return f"Error browsing followers of @{clean}: {e}"


@function_tool
async def browse_following_of(
    wrapper: RunContextWrapper[ScraperContext], handle: str
) -> str:
    """Browse who an influential account follows — great for finding hidden gems.

    Args:
        handle: Twitter handle to check who they follow, e.g. 'naval'
    """
    ctx = wrapper.context
    clean = handle.lstrip("@").strip()
    try:
        url = f"https://x.com/{clean}/following"
        await ctx.page.goto(url, wait_until="domcontentloaded")
        await asyncio.sleep(ctx.config.scroll_delay)

        response = await _safe_query(ctx.page, PEOPLE_SEARCH_QUERY)
        results = response.get("people_results", [])
        if not results:
            return f"Could not load following of @{clean}"

        lines = [f"@{clean} follows ({len(results)} visible):"]
        for p in results:
            username = p.get("username", "?")
            name = p.get("name", "")
            bio = (p.get("bio") or "")[:80]
            followers = _parse_count(p.get("followers_text", "0"))
            lines.append(f"  @{username} | {name} | {followers} followers | {bio}")
        return "\n".join(lines)
    except Exception as e:
        return f"Error browsing following of @{clean}: {e}"


# ═══════════════════════════════════════════════════════════════════════════════
#  STRATEGY 7: "You might like" Sidebar Scraping
# ═══════════════════════════════════════════════════════════════════════════════

YOU_MIGHT_LIKE_QUERY = """
{
    suggested_accounts[] {
        username
        name
        bio
    }
}
"""


@function_tool
async def scrape_you_might_like(
    wrapper: RunContextWrapper[ScraperContext], handle: str
) -> str:
    """Navigate to a Twitter profile and scrape the "You might like" sidebar suggestions.
    These are algorithmically recommended accounts similar to the one you're viewing —
    excellent source of leads in the same niche.

    Args:
        handle: Twitter handle to visit (the sidebar shows suggestions based on this profile)
    """
    ctx = wrapper.context
    clean = handle.lstrip("@").strip()
    try:
        await ctx.page.goto(f"https://x.com/{clean}", wait_until="domcontentloaded")
        await asyncio.sleep(ctx.config.scroll_delay + 1)  # extra wait for sidebar to load

        response = await _safe_query(ctx.page, YOU_MIGHT_LIKE_QUERY)
        results = response.get("suggested_accounts", [])
        if not results:
            return f"No 'You might like' suggestions found on @{clean}'s profile"

        lines = [f"'You might like' on @{clean}'s profile ({len(results)} suggestions):"]
        for p in results:
            username = p.get("username", "?")
            name = p.get("name", "")
            bio = (p.get("bio") or "")[:80]
            lines.append(f"  @{username} | {name} | {bio}")
        return "\n".join(lines)
    except Exception as e:
        return f"Error scraping 'You might like' on @{clean}: {e}"


# ═══════════════════════════════════════════════════════════════════════════════
#  SHARED TOOLS (used by all strategies)
# ═══════════════════════════════════════════════════════════════════════════════


@function_tool
async def scrape_profile(
    wrapper: RunContextWrapper[ScraperContext], handle: str
) -> str:
    """Navigate to a Twitter profile and extract name, bio, followers.

    Args:
        handle: Twitter handle without @, e.g. 'elonmusk'
    """
    ctx = wrapper.context
    clean = handle.lstrip("@").strip()
    try:
        await ctx.page.goto(f"https://x.com/{clean}", wait_until="domcontentloaded")
        await asyncio.sleep(ctx.config.between_profiles_delay)

        response = await _safe_query(ctx.page, PROFILE_QUERY)
        info = response.get("profile_info", {})
        if not info:
            return f"Could not extract profile for @{clean}"

        name = info.get("display_name", clean)
        bio = info.get("bio_text", "")
        followers = _parse_count(info.get("followers_count_text", "0"))
        following = _parse_count(info.get("following_count_text", "0"))

        return (
            f"Profile @{clean}:\n"
            f"  Name: {name}\n"
            f"  Bio: {bio}\n"
            f"  Followers: {followers}\n"
            f"  Following: {following}"
        )
    except Exception as e:
        return f"Error scraping @{clean}: {e}"


@function_tool
async def scroll_and_extract_more(
    wrapper: RunContextWrapper[ScraperContext], query_type: str
) -> str:
    """Scroll current page to load more results and re-extract.

    Args:
        query_type: One of 'people_search', 'quote_tweets', 'google', 'feed'
    """
    ctx = wrapper.context
    try:
        await ctx.page.evaluate("window.scrollBy(0, window.innerHeight * 2)")
        await asyncio.sleep(ctx.config.scroll_delay)

        query_map = {
            "people_search": PEOPLE_SEARCH_QUERY,
            "quote_tweets": QUOTE_TWEETS_QUERY,
            "google": GOOGLE_RESULTS_QUERY,
            "feed": TWITTER_FEED_QUERY,
        }
        aql = query_map.get(query_type, PEOPLE_SEARCH_QUERY)
        response = await _safe_query(ctx.page, aql)
        if response:
            return f"Scrolled, re-extracted:\n{json.dumps(response, indent=2, default=str)}"
        return "Scrolled — no new data."
    except Exception as e:
        return f"Error scrolling: {e}"


@function_tool
async def navigate_to_url(
    wrapper: RunContextWrapper[ScraperContext], url: str
) -> str:
    """Navigate the browser to any URL. Use for following links found via search.

    Args:
        url: Full URL to navigate to
    """
    ctx = wrapper.context
    try:
        await ctx.page.goto(url, wait_until="domcontentloaded")
        await asyncio.sleep(ctx.config.scroll_delay)
        title = await ctx.page.title()
        return f"Navigated to: {url} — Title: {title}"
    except Exception as e:
        return f"Error navigating to {url}: {e}"


@function_tool
async def extract_twitter_handle_from_url(
    wrapper: RunContextWrapper[ScraperContext], url: str
) -> str:
    """Extract a Twitter handle from a URL like https://x.com/username or https://twitter.com/username.

    Args:
        url: A Twitter/X profile URL
    """
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        path = parsed.path.strip("/")
        # Take the first path segment as the handle
        handle = path.split("/")[0] if path else ""
        if handle and handle not in ("search", "explore", "home", "i", "settings", "hashtag"):
            return f"Handle: @{handle}"
        return f"Could not extract handle from {url}"
    except Exception as e:
        return f"Error parsing URL: {e}"


@function_tool(strict_mode=False)
async def save_lead(
    wrapper: RunContextWrapper[ScraperContext],
    handle: str,
    name: str,
    bio: str,
    followers: int,
    tags: str,
    relevancy: str = "high",
) -> str:
    """Save a lead. Deduplicates by handle. Auto-saves periodically.

    Args:
        handle: Twitter handle without @
        name: Display name
        bio: Bio/description text
        followers: Follower count as integer
        tags: Comma-separated tags, e.g. 'designers,founders,educators'
        relevancy: Optional, ignored
    """
    ctx = wrapper.context
    tag_list = [t.strip().lower() for t in tags.split(",") if t.strip()]
    rel = "high"  # always high

    lead = make_lead(
        handle=handle, name=name, bio=bio, followers=followers,
        tags=tag_list, relevancy=rel, user_id=ctx.config.user_id,
    )

    result = ctx.store.add(lead)
    counts = ctx.store.counts()
    flush_msg = _maybe_auto_flush(ctx)
    return (
        f"{result} — @{lead.handle} ({rel}, {followers} followers). "
        f"Totals: {counts['total']} ({counts['high']}H/{counts['low']}L){flush_msg}"
    )


@function_tool
async def check_if_known(
    wrapper: RunContextWrapper[ScraperContext], handle: str
) -> str:
    """Check if a handle already exists in our data.

    Args:
        handle: Twitter handle (with or without @)
    """
    known = wrapper.context.store.is_known(handle)
    return f"@{handle.lstrip('@')}: {'known — skip' if known else 'new — add'}"


@function_tool
async def get_lead_count(wrapper: RunContextWrapper[ScraperContext]) -> str:
    """Get current lead counts (total, high, low)."""
    counts = wrapper.context.store.counts()
    return f"Leads: {counts['total']} total ({counts['high']} high, {counts['low']} low)"


@function_tool
async def flush_leads_to_file(wrapper: RunContextWrapper[ScraperContext]) -> str:
    """Save all collected leads to JSON file in data/exports/."""
    ctx = wrapper.context
    filepath = ctx.store.flush()
    ctx.mark_flushed()
    return f"Saved to: {filepath}"
