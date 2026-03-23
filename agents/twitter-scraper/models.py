"""Lead data model, validation, and storage.

Validation rules are loaded from rules.py — the single source of truth.
When cleaning datasets reveals new junk patterns, add them to rules.py.
"""

from __future__ import annotations

import json
import glob
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel

from rules import (
    MIN_FOLLOWERS,
    MAX_FOLLOWERS,
    COMPANY_BIO_PATTERNS,
    COMPANY_NAME_KEYWORDS,
    COMPANY_NAME_PATTERNS,
    COMPANY_HANDLE_PATTERNS,
    KNOWN_ORG_HANDLES,
    ENGLISH_ONLY,
    NON_LATIN_THRESHOLD,
)


# ── Validation ───────────────────────────────────────────────────────────────


def is_valid_lead(handle: str, name: str, bio: str, followers: int) -> tuple[bool, str]:
    """Validate a lead against rules.py.

    Returns (is_valid, reason).
    """
    clean_handle = handle.lstrip("@").lower().strip()
    bio_lower = (bio or "").lower()
    name_lower = (name or "").lower()

    # ── Follower bounds ──
    if followers < MIN_FOLLOWERS:
        return False, f"needs {MIN_FOLLOWERS}+ followers (has {followers})"
    if followers > MAX_FOLLOWERS:
        return False, f"over {MAX_FOLLOWERS:,} followers — too big"

    # ── Known org handles ──
    if clean_handle in KNOWN_ORG_HANDLES:
        return False, "known organization handle"

    # ── Handle regex patterns ──
    for pattern in COMPANY_HANDLE_PATTERNS:
        if re.search(pattern, clean_handle):
            return False, f"company handle pattern: {pattern}"

    # ── Name-based rejection ──
    for keyword in COMPANY_NAME_KEYWORDS:
        if keyword in name_lower:
            return False, f"company name keyword: '{keyword}'"

    for pattern in COMPANY_NAME_PATTERNS:
        if re.search(pattern, name or ""):
            return False, f"company name pattern: {pattern}"

    # ── Bio-based rejection ──
    for pattern in COMPANY_BIO_PATTERNS:
        if pattern in bio_lower:
            return False, f"company/org bio: '{pattern}'"

    # ── No bio ──
    if not bio or len(bio.strip()) < 5:
        return False, "no bio — can't verify if person"

    # ── English only ──
    if ENGLISH_ONLY and bio:
        non_ascii = sum(1 for c in bio if ord(c) > 127 and not c in "—–''""•·→←↑↓★☆♥♦♠♣✓✗✦✧♻✈☕🎨🎯🚀💡🔥💻📱🎵🎬📷✨🌍🌎🌏")
        total = len(bio.replace(" ", ""))
        if total > 0 and non_ascii / total > NON_LATIN_THRESHOLD:
            return False, "non-English bio"

    return True, "ok"


# ── Lead Model ───────────────────────────────────────────────────────────────


class ScrapedLead(BaseModel):
    id: str
    userId: str
    handle: str
    name: str
    bio: str
    platform: Literal["twitter"] = "twitter"
    deliverables: list = []
    tags: list[str]
    relevancy: str
    url: str
    site: str | None = None
    linkedinUrl: str | None = None
    email: str | None = None
    price: None = None
    notes: str | None = None
    sourceLeadId: str | None = None
    lastSyncedAt: str | None = None
    createdAt: str
    updatedAt: str
    followers: int


def make_lead(
    handle: str,
    name: str,
    bio: str,
    followers: int,
    tags: list[str],
    relevancy: str,
    user_id: str = "twitter-scraper-bot",
) -> ScrapedLead:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + "000Z"
    clean_handle = handle.lstrip("@").strip()
    return ScrapedLead(
        id=str(uuid.uuid4()),
        userId=user_id,
        handle=clean_handle,
        name=name.strip(),
        bio=bio.strip(),
        tags=[t.lower().strip() for t in tags if t.strip()],
        relevancy=relevancy,
        url=f"https://x.com/{clean_handle}",
        createdAt=now,
        updatedAt=now,
        followers=followers,
    )


# ── Lead Store ───────────────────────────────────────────────────────────────


class LeadStore:
    """In-memory lead store with dedup.

    Each run creates a new timestamped file. Loads all previous files for dedup.
    """

    def __init__(self, output_dir: str, user_id: str = "twitter-scraper-bot"):
        self._leads: dict[str, ScrapedLead] = {}
        self._known_handles: set[str] = set()
        self._output_dir = output_dir
        self._user_id = user_id

        timestamp = datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
        self._filepath = os.path.join(output_dir, f"twitter-scraped-leads-{timestamp}.json")
        self._load_existing()

    def _load_existing(self) -> None:
        loaded = 0
        for pattern in [
            os.path.join(self._output_dir, "twitter-scraped-leads-*.json"),
            os.path.join(self._output_dir, "twitter-scraped-leads.json"),
            os.path.join(self._output_dir, "internal-leads-*.json"),
        ]:
            for filepath in glob.glob(pattern):
                try:
                    with open(filepath) as f:
                        data = json.load(f)
                    for entry in data:
                        h = entry.get("handle", "").lower().strip()
                        if h:
                            self._known_handles.add(h)
                            loaded += 1
                except Exception:
                    continue
        print(f"  [LeadStore] {loaded} known handles loaded for dedup")
        print(f"  [LeadStore] Saving to: {os.path.basename(self._filepath)}")

    def is_known(self, handle: str) -> bool:
        key = handle.lstrip("@").lower().strip()
        return key in self._known_handles or key in self._leads

    def add(self, lead: ScrapedLead) -> str:
        key = lead.handle.lower().strip()
        if key in self._known_handles or key in self._leads:
            return "duplicate"
        valid, reason = is_valid_lead(lead.handle, lead.name, lead.bio, lead.followers)
        if not valid:
            return f"rejected — {reason}"
        self._leads[key] = lead
        return "added"

    def counts(self) -> dict[str, int]:
        return {"total": len(self._leads), "high": len(self._leads)}

    def flush(self) -> str:
        if not self._leads:
            return "No leads to save."
        os.makedirs(self._output_dir, exist_ok=True)
        data = [lead.model_dump() for lead in self._leads.values()]
        with open(self._filepath, "w") as f:
            json.dump(data, f, indent=2)
        print(f"  [LeadStore] Saved {len(data)} leads to {self._filepath}")
        return self._filepath
