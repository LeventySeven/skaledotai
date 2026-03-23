"""Scraper configuration — queries match how people actually write their bios."""

from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass
class ScraperConfig:
    output_dir: str = ""
    user_id: str = "twitter-scraper-bot"
    high_relevancy_min_followers: int = 5000
    scroll_delay: float = 2.0
    between_profiles_delay: float = 1.5
    cycle_pause: float = 10.0
    cdp_url: str = "http://localhost:9222"

    # ── Search queries (how people ACTUALLY write bios) ──────────────────

    twitter_search_queries: list[str] = field(default_factory=lambda: [
        # Design — how they write it
        "product designer",
        "UI designer",
        "UX designer",
        "design engineer",
        "motion designer",
        "brand designer",
        "creative director",
        "head of design",
        "design lead",
        "sr designer",
        "senior designer",
        "staff designer",
        "web designer",
        "graphic designer",

        # Engineering — how they write it
        "software engineer",
        "swe",
        "frontend developer",
        "frontend eng",
        "backend engineer",
        "fullstack developer",
        "mobile developer",
        "iOS engineer",
        "ai eng",
        "ml engineer",
        "data scientist",
        "devops",
        "staff engineer",
        "sr engineer",
        "founding engineer",
        "head of eng",
        "eng manager",
        "tech lead",

        # Founders — how they write it
        "founder",
        "co-founder",
        "cofounder",
        "indie hacker",
        "building",
        "shipped",
        "YC W25 founder",
        "YC S24 founder",
        "YC W24 founder",

        # Product
        "product manager",
        "head of product",

        # DevRel / OSS
        "devrel",
        "developer advocate",
        "open source",

        # Creator
        "content creator",
        "design educator",
        "teaching",
    ])

    # ── Google dork templates ────────────────────────────────────────────

    google_dork_templates: list[str] = field(default_factory=lambda: [
        'site:x.com "{role}" "followers"',
        'site:x.com "{role}" "building"',
        'site:x.com "{role}" bio',
        '"{role}" "x.com" portfolio',
    ])

    # ── Google dork roles ────────────────────────────────────────────────

    google_dork_roles: list[str] = field(default_factory=lambda: [
        "product designer",
        "software engineer",
        "founder",
        "UX designer",
        "frontend developer",
        "design engineer",
        "indie hacker",
        "AI researcher",
        "founding engineer",
        "data scientist",
        "motion designer",
        "creative director",
        "devrel",
        "staff engineer",
        "head of design",
        "ml engineer",
    ])

    # ── Search modifiers ─────────────────────────────────────────────────

    search_modifiers: list[str] = field(default_factory=lambda: [
        "building in public",
        "open source",
        "shipped",
        "just launched",
        "indie",
        "bootstrapped",
        "AI",
        "freelance",
    ])


def load_config() -> ScraperConfig:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.abspath(os.path.join(script_dir, "..", ".."))
    output_dir = os.path.join(project_root, "data", "exports")
    config = ScraperConfig(output_dir=output_dir)
    if os.environ.get("SCRAPER_CDP_URL"):
        config.cdp_url = os.environ["SCRAPER_CDP_URL"]
    if os.environ.get("SCRAPER_CYCLE_PAUSE"):
        config.cycle_pause = float(os.environ["SCRAPER_CYCLE_PAUSE"])
    return config
