"""Lead validation rules.

This is the single source of truth for what counts as a valid lead.
When you clean the dataset and find junk, generalize the pattern and add it here.

A lead is a REAL INDIVIDUAL HUMAN who creates content on Twitter,
has 5,000-200,000 followers, and could realistically do a paid promotion.
"""

# ── Follower bounds ──────────────────────────────────────────────────────────

MIN_FOLLOWERS = 5_000
MAX_FOLLOWERS = 200_000

# ── Name-based rejection ─────────────────────────────────────────────────────
# If the display name looks like a company/product/framework, reject.
# These are substrings matched case-insensitively against the display name.

COMPANY_NAME_KEYWORDS = [
    # Tech companies & products
    "google", "microsoft", "apple", "amazon", "meta", "netflix",
    "stripe", "figma", "notion", "linear", "vercel", "supabase",
    "docker", "kubernetes", "github", "gitlab",
    "openai", "anthropic", "huggingface",
    # Frameworks / libraries / languages
    "next.js", "nextjs", "react", "vue.js", "vuejs", "angular", "svelte",
    "node.js", "nodejs", "typescript", "python", "golang", "rust",
    "tailwind", "prisma", "turborepo",
    # Generic company suffixes in names
    " inc.", " ltd.", " llc", " gmbh",
    " platform", " studio", " agency", " group", " labs", " network",
    " media", " news", " daily", " weekly",
    # Broadcasting / sports
    "espn", "nfl", "nba", "mlb", "fifa",
]

# ── Bio-based rejection ──────────────────────────────────────────────────────
# If bio contains any of these (case-insensitive), it's not a person / not our lead.

COMPANY_BIO_PATTERNS = [
    # Company voice ("we" language)
    "we are", "we help", "we build", "we create", "we provide", "we offer", "we make",
    "our mission", "our team", "our platform", "our product",
    # Official / corporate
    "official account", "the official", "official page",
    "follow along for", "follow us", "follow for updates",
    "product news", "company updates", "news and updates",
    # Legal suffixes
    "inc.", "ltd.", "llc", "gmbh", "co.", "corp.",
    # Trademarks
    "™", "®", "©",
    # Platform / tool language
    "platform for", "powered by", "maintained by", "created and maintained",
    "open source project", "open-source framework",
    # Job boards / hiring
    "job posting", "job marketplace", "hiring platform", "remote job",
    "job board", "careers page",
    # Aggregator / curation
    "news feed", "curated by", "curating", "highlight what matters",
    "#1 source", "across the planet", "subscribe to us",
    "content that matters", "thoughts not my own", "sharing content",
    "industry lead",
    # Parody / fan
    "parody", "fan account", "not affiliated", "satire",
    # Sports / broadcasting
    "radio play-by-play", "broadcaster", "sidelines", "sports reporter",
    "bills reporter", "nfl", "nba", "mlb", "play-by-play",
    "sports anchor", "sports journalist",
    # Politics / government
    "commissioner", "senator", "congressman", "governor", "politician",
    "minister of", "secretary of", "member of parliament",
    # Corporate titles that indicate unreachable people
    "keynote speaker", "global keynote", "world-renowned",
    "board chair", "board member", "board of directors",
    # Meme / viral aggregators
    "daily history", "education through memes", "viral news",
    "memes. crypto. finance", "finance, economics, news",
    "meme page", "meme account",
    # News organizations
    "breaking news", "reporting for", "correspondent for",
    "editor-in-chief", "managing editor",
    # Too corporate / enterprise
    "head of global", "global head of", "chief revenue officer",
    "enterprise sales", "fortune 500",
]

# ── Handle-based rejection ───────────────────────────────────────────────────
# Regex patterns matched against lowercase handle.

COMPANY_HANDLE_PATTERNS = [
    r"^(get|try|use|join)[a-z]{3,}$",      # getStream, tryLinear (not "getMike")
    r"(hq|_sdk|_js|_ai)$",                 # companyHQ (not "io" or "dev" — too many real people)
    r"_jobs?$", r"_careers?$", r"_hiring$", # company_jobs
    r"(feed|daily|news|memes)$",            # techfeed, dailynews
    r"^(team|all)[a-z]+$",                  # teamSlack, allDevs
    r"^official[a-z]+$",                    # officialXyz
]

# ── Known organization handles ───────────────────────────────────────────────
# Exact lowercase handle matches — always rejected.

KNOWN_ORG_HANDLES = {
    # Frameworks / tools
    "nextjs", "vercel", "reactjs", "vuejs", "angular", "svelte",
    "nodejs", "golang", "rust_lang", "typescript", "python",
    "docker", "kubernetes", "supabase", "prisma", "tailwindcss", "turborepo",
    "webpack", "vitejs", "eslint", "prettier",
    # Companies
    "google", "googlecloudtech", "awscloud", "azure", "github", "gitlab",
    "stripe", "figma", "linear", "notion", "slack", "discord",
    "openai", "anthropic", "huggingface", "mistabormanai",
    "spotify", "netflix", "airbnb", "uber", "lyft",
    "shopify", "atlassian", "datadog", "cloudflare", "twilio",
    # Media / aggregators
    "historyinmemes", "stats_feed", "nocontexthumans", "interneth0f",
    "dailyloud", "interesting_ail", "wallstreetmav", "kobeissiletter",
    "therabbithole", "aihighlight", "techcrunch", "theverge", "waborman",
    # Sports
    "espn", "nfl", "nba", "mlb",
    # Generic
    "startup", "startups",
    # Broadcast shows
    "onebillslive", "frontendmasters",
}

# ── Name patterns that indicate a company (not a person) ─────────────────────
# If the display name matches these regex patterns, reject.

COMPANY_NAME_PATTERNS = [
    r"^[A-Z][a-z]+\.(js|io|ai|dev|app|co)$",  # Next.js, Prisma.io
    r"^[A-Z]{4,}$",                             # All-caps acronym 4+ chars (NASA, ESPN — not "KP")
    r" (Inc|Ltd|LLC|GmbH|Corp)\.?$",            # Stripe Inc.
]

# ── Language filter ──────────────────────────────────────────────────────────
# Only English-language accounts. If bio is primarily non-Latin script, reject.
# We check for high ratio of non-ASCII characters.

ENGLISH_ONLY = True  # set to False to allow all languages
NON_LATIN_THRESHOLD = 0.3  # if >30% of bio chars are non-Latin, reject
