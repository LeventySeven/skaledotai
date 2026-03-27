"""Viral Quotes Lead Scraper — runs forever until Ctrl+C.

Two ways to find quote leads:

  A) FEED QUOTES — scroll "For You", spot quote tweets directly in the feed
     (someone quoting a viral post with their own text/media). These are
     already leads. Example: @kofifiada quoting @lucashjin with 150K views.

  B) POST QUOTES — for viral posts (not quotes themselves) found in the feed,
     open their /quotes page and scrape all quote authors with 100k+ views.

Both paths enrich each lead with full profile info (bio, followers) and
full stats (views, likes, reposts, comments, bookmarks).

Requires: Chrome running with --remote-debugging-port=9222, logged into Twitter.
"""

from __future__ import annotations

import asyncio
import json
import os
import signal
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import agentql
from playwright.async_api import async_playwright

from dotenv import load_dotenv
from models import is_valid_lead
from rules import KNOWN_ORG_HANDLES

_project_root = Path(__file__).resolve().parent.parent.parent
load_dotenv(_project_root / ".env")

# ── Config ──────────────────────────────────────────────────────────────────

CDP_URL = os.environ.get("SCRAPER_CDP_URL", "http://localhost:9222")
MIN_VIEWS = 100_000          # 100k+ views threshold
SCROLL_DELAY = 2.5
SCROLL_TIMES_FEED = 30       # scrolls per feed pass
SCROLL_TIMES_QUOTES = 20     # scrolls per quotes page
CYCLE_PAUSE = 15.0           # pause between full cycles
AUTO_SAVE_INTERVAL = 300     # auto-save every 5 minutes
AUTO_SAVE_COUNT = 10         # auto-save every N new entries
OUTPUT_DIR = os.path.join(_project_root, "data", "exports")

# ── Lead filtering ──────────────────────────────────────────────────────────

MEGA_ACCOUNT_HANDLES = {
    # Celebrities / politicians
    "elonmusk", "potus", "barackobama", "joebiden", "billgates",
    "jeffbezos", "timcook", "satyanadella", "sundarpichai",
    "markzuckerberg", "jack", "kyliejenner",
    "kimkardashian", "cristiano", "kingjames", "drake",
    "taylorswift13", "katyperry", "justinbieber", "rihanna",
    "selenagomez", "arianagrande", "therock", "kevinhart4real",
    "neymarjr", "oprah", "pmarca", "naval",
    "realdonaldtrump",
    # Big tech / AI brand accounts
    "claudeai", "openai", "anthropic", "google", "googledeepmind",
    "microsoft", "nvidia", "meta", "apple", "amazon",
    "xai", "chatgptapp",
    # Media / news / sports
    "nba", "nfl", "espn",
    "cnn", "bbcworld", "nytimes", "wsj", "reuters",
}

# ── Helpers ─────────────────────────────────────────────────────────────────


def parse_count(text: str | None) -> int:
    """Parse '5.2K', '265.6K', '1.2M', '2B' into int."""
    if not text:
        return 0
    text = text.strip().upper().replace(",", "").replace(" ", "")
    for suffix in ["VIEWS", "VIEW", "FOLLOWERS", "FOLLOWER", "FOLLOWING",
                    "LIKES", "LIKE", "REPOSTS", "REPOST", "REPLIES", "REPLY",
                    "QUOTES", "QUOTE", "BOOKMARKS", "BOOKMARK", "COMMENTS", "COMMENT"]:
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


def is_skippable(handle: str) -> bool:
    """Quick check if handle is a mega-account or known org."""
    h = handle.lstrip("@").lower().strip()
    return h in MEGA_ACCOUNT_HANDLES or h in KNOWN_ORG_HANDLES


QUOTE_LEAD_MIN_FOLLOWERS = 2_500

def is_valid_quote_lead(handle: str, name: str, bio: str, followers: int) -> tuple[bool, str]:
    """Check if a quote author qualifies as a lead.
    Uses 2,500 min followers instead of the global 5,000.
    """
    clean = handle.lstrip("@").lower().strip()
    if clean in MEGA_ACCOUNT_HANDLES:
        return False, f"mega-account: @{clean}"
    if followers < QUOTE_LEAD_MIN_FOLLOWERS:
        return False, f"needs {QUOTE_LEAD_MIN_FOLLOWERS}+ followers (has {followers})"
    # Run the rest of is_valid_lead but skip its own min-follower check
    # by temporarily passing followers that satisfy the global threshold
    import rules
    original_min = rules.MIN_FOLLOWERS
    rules.MIN_FOLLOWERS = QUOTE_LEAD_MIN_FOLLOWERS
    try:
        return is_valid_lead(handle, name, bio, followers)
    finally:
        rules.MIN_FOLLOWERS = original_min


# ── AgentQL Queries ─────────────────────────────────────────────────────────

# Feed query — detects both regular posts AND quote tweets.
# For quote tweets: the author is the person quoting, quoted_author is original.
FEED_POSTS_QUERY = """
{
    tweets[] {
        author_handle
        author_name
        tweet_text
        views_text
        likes_text
        reposts_text
        replies_text
        tweet_link_url
        is_quote_tweet
        quoted_tweet_author_handle
        quoted_tweet_text
    }
}
"""

POST_DETAIL_QUERY = """
{
    post {
        author_handle
        author_name
        author_bio
        author_followers_text
        tweet_text
        views_text
        likes_text
        reposts_text
        replies_text
        quotes_text
        bookmarks_text
        image_urls[]
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

QUOTES_PAGE_QUERY = """
{
    quote_tweets[] {
        author_handle
        author_name
        quote_text
        views_text
        likes_text
        reposts_text
        replies_text
        bookmarks_text
        image_urls[]
        tweet_link_url
    }
}
"""

# ── Browser setup ───────────────────────────────────────────────────────────


async def setup_browser():
    agentql_key = os.environ.get("AGENTQL_API_KEY")
    if agentql_key:
        agentql.configure(api_key=agentql_key)
    else:
        print("  [WARN] AGENTQL_API_KEY not set")

    pw = await async_playwright().start()
    browser = await pw.chromium.connect_over_cdp(CDP_URL)
    contexts = browser.contexts
    context = contexts[0] if contexts else await browser.new_context()
    raw_page = await context.new_page()
    page = await agentql.wrap_async(raw_page)
    print("  [Browser] Connected via CDP + AgentQL")
    return pw, browser, page


async def safe_query(page, query: str, retries: int = 2) -> dict:
    for attempt in range(retries + 1):
        try:
            response = await page.query_data(query, wait_for_network_idle=True, timeout=30)
            return response if isinstance(response, dict) else {}
        except Exception as e:
            if attempt < retries:
                print(f"  [AgentQL] Retry {attempt + 1}/{retries}: {e}")
                await asyncio.sleep(3 * (attempt + 1))
            else:
                print(f"  [AgentQL] Failed after {retries + 1} attempts: {e}")
                return {}


async def get_profile_info(page, handle: str) -> dict:
    """Navigate to profile and get bio + followers."""
    clean = handle.lstrip("@").strip()
    try:
        await page.goto(f"https://x.com/{clean}", wait_until="domcontentloaded")
        await asyncio.sleep(2)
        response = await safe_query(page, PROFILE_QUERY)
        info = response.get("profile_info", {})
        return {
            "name": info.get("display_name", clean),
            "handle": clean,
            "bio": info.get("bio_text", ""),
            "followers": parse_count(info.get("followers_count_text", "0")),
            "following": parse_count(info.get("following_count_text", "0")),
        }
    except Exception as e:
        print(f"  [Profile] Error for @{clean}: {e}")
        return {"name": clean, "handle": clean, "bio": "", "followers": 0, "following": 0}


# ── Core scraping ───────────────────────────────────────────────────────────


async def scrape_for_you_feed(page, seen_post_urls: set, seen_quote_handles: set,
                              results: list[dict], maybe_auto_save, elapsed_str):
    """Scroll For You feed. Saves feed quotes to results IMMEDIATELY.

    Returns viral_posts (regular posts to later check /quotes on).
    Feed quote leads are enriched and saved inline — never lost on Ctrl+C.
    """
    print("\n  [Feed] Navigating to For You feed...")
    await page.goto("https://x.com/home", wait_until="domcontentloaded")
    await asyncio.sleep(3)

    feed_quote_count = 0
    viral_posts = []
    seen_texts = set()

    for scroll_round in range(SCROLL_TIMES_FEED):
        response = await safe_query(page, FEED_POSTS_QUERY)
        tweets = response.get("tweets", [])

        for t in tweets:
            text = (t.get("tweet_text") or "")[:200]
            link = t.get("tweet_link_url", "")
            if text in seen_texts:
                continue
            seen_texts.add(text)

            if link and link in seen_post_urls:
                continue

            handle = (t.get("author_handle") or "").lstrip("@").strip()
            views = parse_count(t.get("views_text", "0"))
            is_quote = t.get("is_quote_tweet", False)
            quoted_handle = (t.get("quoted_tweet_author_handle") or "").lstrip("@").strip()

            # ── Path A: QUOTE TWEET in the feed — enrich + save immediately ──
            if is_quote and views >= MIN_VIEWS:
                if is_skippable(handle):
                    print(f"    [Skip] @{handle} — mega/org, skipping quote")
                    continue
                handle_lower = handle.lower()
                if handle_lower in seen_quote_handles:
                    continue
                seen_quote_handles.add(handle_lower)

                print(f"    [FeedQuote] @{handle} quoting @{quoted_handle} — {views:,} views — {text[:50]}")

                # Enrich immediately — navigate to profile, then come back
                enriched = await enrich_quote_lead(page, handle, t.get("author_name", ""), {
                    "quote_text": t.get("tweet_text", ""),
                    "quote_views": views,
                    "quote_likes": parse_count(t.get("likes_text", "0")),
                    "quote_reposts": parse_count(t.get("reposts_text", "0")),
                    "quote_comments": parse_count(t.get("replies_text", "0")),
                    "images": [],
                    "quote_link": link,
                })
                if enriched:
                    results.append({
                        "source": "feed_quote",
                        "original_post": {
                            "author_handle": quoted_handle,
                            "text": t.get("quoted_tweet_text", ""),
                        },
                        "viral_quotes": [enriched],
                        "scraped_at": datetime.now(timezone.utc).isoformat(),
                    })
                    feed_quote_count += 1
                    print(f"    [SAVED] @{handle} | Total: {len(results)} leads")
                    maybe_auto_save()

                # Return to feed after profile visit
                await page.goto("https://x.com/home", wait_until="domcontentloaded")
                await asyncio.sleep(2)
                # Scroll back down to roughly where we were
                for _ in range(max(1, scroll_round)):
                    await page.evaluate("window.scrollBy(0, window.innerHeight * 3)")
                    await asyncio.sleep(0.5)
                continue

            # ── Path B: Regular post with 100k+ views ──
            if not is_quote and views >= MIN_VIEWS:
                if is_skippable(handle):
                    print(f"    [Skip] @{handle} — mega/org, skipping post")
                    continue

                viral_posts.append({
                    "handle": handle,
                    "name": t.get("author_name", ""),
                    "text": t.get("tweet_text", ""),
                    "views": views,
                    "likes": parse_count(t.get("likes_text", "0")),
                    "reposts": parse_count(t.get("reposts_text", "0")),
                    "comments": parse_count(t.get("replies_text", "0")),
                    "link": link,
                })
                print(f"    [Post] @{handle} — {views:,} views — {text[:60]}")

        await page.evaluate("window.scrollBy(0, window.innerHeight * 2)")
        await asyncio.sleep(SCROLL_DELAY)

        if scroll_round % 5 == 4:
            print(f"  [Feed] Scrolled {scroll_round + 1}/{SCROLL_TIMES_FEED}"
                  f" — {feed_quote_count} feed quotes saved, {len(viral_posts)} posts queued")

    print(f"\n  [Feed] Done: {feed_quote_count} quote leads saved from feed, "
          f"{len(viral_posts)} posts to check /quotes on")
    return viral_posts


async def scrape_post_detail(page, post_url: str) -> dict:
    """Open a post and extract full stats."""
    try:
        await page.goto(post_url, wait_until="domcontentloaded")
        await asyncio.sleep(3)

        response = await safe_query(page, POST_DETAIL_QUERY)
        post_data = response.get("post", {})

        return {
            "author_handle": (post_data.get("author_handle") or "").lstrip("@").strip(),
            "author_name": post_data.get("author_name", ""),
            "author_bio": post_data.get("author_bio", ""),
            "author_followers": parse_count(post_data.get("author_followers_text", "0")),
            "text": post_data.get("tweet_text", ""),
            "views": parse_count(post_data.get("views_text", "0")),
            "likes": parse_count(post_data.get("likes_text", "0")),
            "reposts": parse_count(post_data.get("reposts_text", "0")),
            "comments": parse_count(post_data.get("replies_text", "0")),
            "quotes": parse_count(post_data.get("quotes_text", "0")),
            "bookmarks": parse_count(post_data.get("bookmarks_text", "0")),
            "images": post_data.get("image_urls", []),
        }
    except Exception as e:
        print(f"  [Post] Error: {e}")
        return {}


async def scrape_quotes_page(page, post_url: str, seen_quote_handles: set) -> list[dict]:
    """Open /quotes page and collect quotes with 100k+ views, skipping already-seen handles."""
    quotes_url = post_url.rstrip("/") + "/quotes"
    print(f"  [Quotes] Opening {quotes_url}")

    try:
        await page.goto(quotes_url, wait_until="domcontentloaded")
        await asyncio.sleep(3)
    except Exception as e:
        print(f"  [Quotes] Navigation error: {e}")
        return []

    all_quotes = []
    seen_quote_texts = set()

    for scroll_round in range(SCROLL_TIMES_QUOTES):
        response = await safe_query(page, QUOTES_PAGE_QUERY)
        quotes = response.get("quote_tweets", [])

        for q in quotes:
            q_text = (q.get("quote_text") or "")[:200]
            if q_text in seen_quote_texts:
                continue
            seen_quote_texts.add(q_text)

            views = parse_count(q.get("views_text", "0"))
            if views < MIN_VIEWS:
                continue

            handle = (q.get("author_handle") or "").lstrip("@").strip()
            handle_lower = handle.lower()

            if is_skippable(handle):
                print(f"    [Skip] @{handle} — mega/org")
                continue
            if handle_lower in seen_quote_handles:
                continue
            seen_quote_handles.add(handle_lower)

            all_quotes.append({
                "author_handle": handle,
                "author_name": q.get("author_name", ""),
                "quote_text": q_text,
                "views": views,
                "likes": parse_count(q.get("likes_text", "0")),
                "reposts": parse_count(q.get("reposts_text", "0")),
                "comments": parse_count(q.get("replies_text", "0")),
                "bookmarks": parse_count(q.get("bookmarks_text", "0")),
                "images": q.get("image_urls", []),
                "link": q.get("tweet_link_url", ""),
            })
            print(f"    [Quote] @{handle} — {views:,} views — {q_text[:50]}")

        await page.evaluate("window.scrollBy(0, window.innerHeight * 2)")
        await asyncio.sleep(SCROLL_DELAY)

    print(f"  [Quotes] Found {len(all_quotes)} new quote leads with {MIN_VIEWS:,}+ views")
    return all_quotes


# ── Enrichment ──────────────────────────────────────────────────────────────


async def enrich_quote_lead(page, handle: str, name: str, raw_quote: dict) -> dict | None:
    """Get profile info, validate, return enriched lead or None."""
    if is_skippable(handle):
        return None

    profile = await get_profile_info(page, handle)

    valid, reason = is_valid_quote_lead(
        handle,
        profile.get("name", name),
        profile.get("bio", ""),
        profile.get("followers", 0),
    )
    if not valid:
        print(f"    [Skip] @{handle} — {reason}")
        return None

    return {
        "quote_author": {
            "handle": handle,
            "name": profile.get("name", name),
            "bio": profile.get("bio", ""),
            "followers": profile.get("followers", 0),
            "following": profile.get("following", 0),
        },
        "quote_text": raw_quote.get("quote_text", raw_quote.get("quote_text", "")),
        "quote_views": raw_quote.get("views", raw_quote.get("quote_views", 0)),
        "quote_likes": raw_quote.get("likes", raw_quote.get("quote_likes", 0)),
        "quote_reposts": raw_quote.get("reposts", raw_quote.get("quote_reposts", 0)),
        "quote_comments": raw_quote.get("comments", raw_quote.get("quote_comments", 0)),
        "quote_bookmarks": raw_quote.get("bookmarks", raw_quote.get("quote_bookmarks", 0)),
        "quote_images": raw_quote.get("images", []),
        "quote_link": raw_quote.get("link", raw_quote.get("quote_link", "")),
    }


# ── Persistence ─────────────────────────────────────────────────────────────


def save_results(results: list[dict], filepath: str | None = None) -> str:
    if not results:
        print("  No results to save.")
        return ""

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    if not filepath:
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        filepath = os.path.join(OUTPUT_DIR, f"viral-quotes-leads-{timestamp}.json")

    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    total_quotes = sum(len(r.get("viral_quotes", [])) for r in results)
    feed_count = sum(1 for r in results if r.get("source") == "feed_quote")
    page_count = sum(1 for r in results if r.get("source") == "quotes_page")
    print(f"\n  Saved to: {filepath}")
    print(f"  Total entries: {len(results)} | Feed quotes: {feed_count} | From /quotes pages: {page_count}")
    return filepath


# ── Main infinite loop ──────────────────────────────────────────────────────


async def main():
    print("\n" + "=" * 60)
    print("  Viral Quotes Lead Scraper — INFINITE MODE")
    print(f"  Min views: {MIN_VIEWS:,}")
    print(f"  CDP: {CDP_URL}")
    print(f"  Auto-save: every {AUTO_SAVE_INTERVAL}s or {AUTO_SAVE_COUNT} entries")
    print("  Ctrl+C to stop (auto-saves)")
    print("=" * 60 + "\n")

    pw, browser, page = await setup_browser()

    results: list[dict] = []
    seen_post_urls: set[str] = set()
    seen_quote_handles: set[str] = set()  # dedup quote authors across everything
    output_filepath: str | None = None
    last_save_time = time.time()
    last_save_count = 0
    start_time = time.time()
    cycle = 0

    _shutting_down = False

    def save_and_exit(sig=None, frame=None):
        nonlocal _shutting_down
        if _shutting_down:
            sys.exit(1)
        _shutting_down = True
        elapsed = int(time.time() - start_time)
        print(f"\n\n  [!] Shutting down after {elapsed}s — {len(results)} leads collected")
        save_results(results, output_filepath)
        sys.exit(0)

    signal.signal(signal.SIGINT, save_and_exit)
    signal.signal(signal.SIGTERM, save_and_exit)

    def maybe_auto_save():
        nonlocal last_save_time, last_save_count, output_filepath
        count_delta = len(results) - last_save_count
        time_delta = time.time() - last_save_time
        if count_delta >= AUTO_SAVE_COUNT or (count_delta > 0 and time_delta >= AUTO_SAVE_INTERVAL):
            output_filepath = save_results(results, output_filepath)
            last_save_time = time.time()
            last_save_count = len(results)

    def elapsed_str() -> str:
        s = int(time.time() - start_time)
        h, m, sec = s // 3600, (s % 3600) // 60, s % 60
        return f"{h}h{m:02d}m{sec:02d}s" if h else f"{m}m{sec:02d}s"

    while not _shutting_down:
        cycle += 1

        print(f"\n{'=' * 60}")
        print(f"  CYCLE {cycle} | {elapsed_str()} | {len(results)} leads | {len(seen_quote_handles)} unique handles")
        print(f"{'=' * 60}\n")

        try:
            # ── Step 1: Scroll feed — save feed quotes immediately, collect posts ──
            viral_posts = await scrape_for_you_feed(
                page, seen_post_urls, seen_quote_handles,
                results, maybe_auto_save, elapsed_str
            )

            if viral_posts:
                print(f"\n  Processing {len(viral_posts)} viral posts for /quotes...\n")

                for i, feed_post in enumerate(viral_posts):
                    if _shutting_down:
                        break

                    post_url = feed_post.get("link", "")
                    if post_url and not post_url.startswith("http"):
                        post_url = "https://x.com" + post_url

                    if not post_url or "/status/" not in post_url:
                        continue

                    seen_post_urls.add(post_url)
                    seen_post_urls.add(feed_post.get("link", ""))

                    print(f"\n{'─' * 50}")
                    print(f"  Post {i + 1}/{len(viral_posts)}: @{feed_post['handle']} — {feed_post['views']:,} views")
                    print(f"{'─' * 50}")

                    # Get post detail
                    post_detail = await scrape_post_detail(page, post_url)
                    if not post_detail:
                        continue

                    # Get author profile
                    author_handle = post_detail.get("author_handle") or feed_post.get("handle", "")
                    if author_handle:
                        author_profile = await get_profile_info(page, author_handle)
                    else:
                        author_profile = {"name": "", "handle": "", "bio": "", "followers": 0, "following": 0}

                    # Scrape /quotes page
                    raw_quotes = await scrape_quotes_page(page, post_url, seen_quote_handles)

                    # Enrich each quote author
                    enriched_quotes = []
                    for q in raw_quotes:
                        if _shutting_down:
                            break
                        q_handle = q.get("author_handle", "")
                        enriched = await enrich_quote_lead(page, q_handle, q.get("author_name", ""), q)
                        if enriched:
                            enriched_quotes.append(enriched)

                    if enriched_quotes:
                        results.append({
                            "source": "quotes_page",
                            "original_post": {
                                "url": post_url,
                                "author": {
                                    "handle": author_handle,
                                    "name": author_profile.get("name", post_detail.get("author_name", "")),
                                    "bio": author_profile.get("bio", post_detail.get("author_bio", "")),
                                    "followers": author_profile.get("followers", post_detail.get("author_followers", 0)),
                                    "following": author_profile.get("following", 0),
                                },
                                "text": post_detail.get("text", feed_post.get("text", "")),
                                "views": post_detail.get("views", feed_post.get("views", 0)),
                                "likes": post_detail.get("likes", feed_post.get("likes", 0)),
                                "reposts": post_detail.get("reposts", feed_post.get("reposts", 0)),
                                "comments": post_detail.get("comments", feed_post.get("comments", 0)),
                                "quotes_count": post_detail.get("quotes", 0),
                                "bookmarks": post_detail.get("bookmarks", 0),
                                "images": post_detail.get("images", []),
                            },
                            "viral_quotes": enriched_quotes,
                            "scraped_at": datetime.now(timezone.utc).isoformat(),
                        })
                        print(f"\n  [{elapsed_str()}] +{len(enriched_quotes)} quote leads from post | Total: {len(results)}")

                    maybe_auto_save()
                    await asyncio.sleep(2)

        except Exception as e:
            print(f"\n  [ERROR] {e}")
            maybe_auto_save()
            await asyncio.sleep(5)

        maybe_auto_save()
        print(f"\n  Cycle {cycle} done. Pausing {CYCLE_PAUSE}s before next cycle...")
        await asyncio.sleep(CYCLE_PAUSE)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except SystemExit:
        pass
