"""Scrape Twitter profiles from Fedica Build page.

Usage:
    1. Chrome running with --remote-debugging-port=9222
    2. https://fedica.com/build/ open and loaded
    3. Run: python fedica_scraper.py
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

_project_root = Path(__file__).resolve().parent.parent.parent
load_dotenv(_project_root / ".env")

import signal

from playwright.async_api import async_playwright

# ── Config ───────────────────────────────────────────────────────────────────

CDP_URL = os.environ.get("SCRAPER_CDP_URL", "http://localhost:9222")
MIN_FOLLOWING = 100
MIN_FOLLOWERS = 10_000
MAX_FOLLOWERS = 200_000
PAGES_TO_SCRAPE = 100
OUTPUT_DIR = str(_project_root / "data" / "exports")
DELAY_BETWEEN_PAGES = 3.5


def parse_count(text: str) -> int:
    if not text:
        return 0
    text = text.strip().upper().replace(",", "")
    try:
        if text.endswith("M"):
            return int(float(text[:-1]) * 1_000_000)
        elif text.endswith("K"):
            return int(float(text[:-1]) * 1_000)
        else:
            return int(float(text))
    except (ValueError, TypeError):
        return 0


async def extract_profiles(page) -> list[dict]:
    """Extract profile cards from current Fedica page."""
    await asyncio.sleep(2)

    return await page.evaluate("""
    () => {
        const results = [];
        const seen = new Set();
        const text = document.body.innerText;

        const parts = text.split(/(@\\w{1,30})(?=\\s)/g);

        for (let i = 1; i < parts.length; i += 2) {
            const handle = parts[i].replace('@', '');
            const after = (parts[i + 1] || '');
            const before = (parts[i - 1] || '');

            if (seen.has(handle.toLowerCase())) continue;

            const statsMatch = after.match(/(\\d[\\d.,]*[KMB]?)\\s*Following\\s+(\\d[\\d.,]*[KMB]?)\\s*Followers/i);
            if (!statsMatch) continue;

            seen.add(handle.toLowerCase());

            const beforeLines = before.split('\\n').map(l => l.trim()).filter(l => l.length > 0);
            let name = beforeLines[beforeLines.length - 1] || handle;
            name = name.replace(/[\\u2713\\u2714\\u2611\\uFE0F\\u200D]/g, '').replace(/\\s+/g, ' ').trim();

            let bio = '';
            const afterFollowers = after.substring(after.indexOf('Followers') + 'Followers'.length);
            const bioLines = afterFollowers.split('\\n')
                .map(l => l.trim())
                .filter(l => l.length > 3
                    && !/^(Ignore|Follow|& Follow|Select All|Selected|Send Selection|Sort by)$/i.test(l)
                    && !l.match(/^\\d+ of \\d+/)
                    && !l.match(/is not following you$/i)
                );
            if (bioLines.length > 0) {
                bio = bioLines.slice(0, 4).join(' | ').substring(0, 300);
            }

            results.push({
                handle,
                name,
                bio,
                following_text: statsMatch[1],
                followers_text: statsMatch[2],
            });
        }
        return results;
    }
    """)


async def click_next(page) -> bool:
    """Click the Fedica '>' next page button via its onclick JS function."""
    try:
        # The next button has: title="Next" and onclick="pagerequest(...)"
        clicked = await page.evaluate("""
        () => {
            // Find the Next button by title
            const nextBtn = document.querySelector('[title="Next"]:not(.disabled)');
            if (nextBtn) {
                nextBtn.click();
                return true;
            }
            // Fallback: find by chevron-right SVG
            const svgs = document.querySelectorAll('svg.directional');
            for (const svg of svgs) {
                const use = svg.querySelector('use');
                if (use && use.getAttribute('href') && use.getAttribute('href').includes('chevron-right')) {
                    const btn = svg.closest('[onclick], button, a, div.btn');
                    if (btn && !btn.classList.contains('disabled')) {
                        btn.click();
                        return true;
                    }
                }
            }
            return false;
        }
        """)

        if clicked:
            # Wait for new content to load
            await asyncio.sleep(DELAY_BETWEEN_PAGES)
            # Wait until page content changes (pagination updates)
            try:
                await page.wait_for_function(
                    "() => !document.querySelector('[title=\"Next\"].loading')",
                    timeout=15000,
                )
            except Exception:
                pass
            await asyncio.sleep(1)
            return True

        return False
    except Exception as e:
        print(f"\n  Next error: {e}")
        return False


async def main():
    print("\n" + "=" * 60)
    print("  Fedica Profile Scraper")
    print(f"  Filters: {MIN_FOLLOWING}+ following, {MIN_FOLLOWERS//1000}k-{MAX_FOLLOWERS//1000}k followers")
    print(f"  Pages: {PAGES_TO_SCRAPE}")
    print("=" * 60 + "\n")

    pw = await async_playwright().start()
    browser = await pw.chromium.connect_over_cdp(CDP_URL)
    context = browser.contexts[0]

    fedica_page = None
    for p in context.pages:
        if "fedica.com" in (p.url or ""):
            fedica_page = p
            break

    if not fedica_page:
        print("  ERROR: Open https://fedica.com/build/ in Chrome first.")
        await pw.stop()
        return

    print(f"  Found: {fedica_page.url}\n")

    all_leads = []
    seen = set()

    # Single output file for the whole run
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    filepath = os.path.join(OUTPUT_DIR, "fedica-leads.json")

    _stop = False

    def _save_and_exit(*_):
        nonlocal _stop
        if _stop:
            sys.exit(1)
        _stop = True
        print("\n\n  [!] Saving before exit...")
        if all_leads:
            with open(filepath, "w") as f:
                json.dump(all_leads, f, indent=2)
            print(f"  Saved {len(all_leads)} leads to {filepath}")
        sys.exit(0)

    signal.signal(signal.SIGINT, _save_and_exit)
    signal.signal(signal.SIGTERM, _save_and_exit)

    for page_num in range(1, PAGES_TO_SCRAPE + 1):
        sys.stdout.write(f"  Page {page_num}/{PAGES_TO_SCRAPE}...")
        sys.stdout.flush()

        profiles = await extract_profiles(fedica_page)
        sys.stdout.write(f" {len(profiles)} cards")

        added = 0
        skipped = 0
        for p in profiles:
            handle = p["handle"].lower()
            if handle in seen:
                continue

            following = parse_count(p["following_text"])
            followers = parse_count(p["followers_text"])

            # BOTH conditions must match
            if not (following >= MIN_FOLLOWING and MIN_FOLLOWERS <= followers <= MAX_FOLLOWERS):
                skipped += 1
                continue

            seen.add(handle)
            all_leads.append({
                "handle": p["handle"],
                "name": p["name"],
                "bio": p["bio"],
                "url": f"https://x.com/{p['handle']}",
                "followers": followers,
                "following": following,
            })
            added += 1

        print(f" → +{added} saved, {skipped} skipped ({len(all_leads)} total)")

        # Save progress every 10 pages (overwrite same file)
        if page_num % 10 == 0 and all_leads:
            with open(filepath, "w") as f:
                json.dump(all_leads, f, indent=2)
            print(f"  [checkpoint] {len(all_leads)} leads saved")

        if page_num < PAGES_TO_SCRAPE:
            ok = await click_next(fedica_page)
            if not ok:
                print("  Could not click next — stopping.")
                break

    # Final save
    if all_leads:
        with open(filepath, "w") as f:
            json.dump(all_leads, f, indent=2)

    print(f"\n{'=' * 60}")
    print(f"  Done: {len(all_leads)} leads from {page_num} pages")
    print(f"  Saved: {filepath}")
    print(f"{'=' * 60}\n")

    await pw.stop()


if __name__ == "__main__":
    asyncio.run(main())
