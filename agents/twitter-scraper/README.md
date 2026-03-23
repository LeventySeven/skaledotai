# Twitter Lead Scraper — Infinite Autonomous Agent

Runs forever, continuously discovering leads on Twitter through multiple strategies. Press Ctrl+C to stop — leads auto-save.

## Setup

```bash
# 1. Install
pip install -r requirements.txt
playwright install chromium

# 2. Launch Chrome with remote debugging (close Chrome first)
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

# 3. Log into Twitter/X in that browser

# 4. Run (API keys loaded from project root .env)
python main.py
```

## How It Works

The bot runs in an **infinite loop**, rotating through 5 discovery strategies:

| # | Strategy | Relevancy | How |
|---|----------|-----------|-----|
| 1 | **Twitter People Search** | High | Searches for "product designer", "SWE", "founder", etc. Filters 5k+ followers |
| 2 | **Google Dork Search** | High | `site:x.com "designer" "followers"` etc. Extracts handles from results |
| 3 | **Web Search (DuckDuckGo)** | High | Fallback when Google shows captcha |
| 4 | **Viral Quote Mining** | Low | Finds viral posts (250k+ views), collects quoters |
| 5 | **Twitter Explore** | Mixed | Browses trending/tech/business tabs for active accounts |

Each cycle: pick strategy → build mission → run agent → save leads → pause → repeat.

## Output

Leads saved to `data/exports/twitter-scraped-leads-{timestamp}.json` in the same format as existing project leads. Auto-saves every 30 new leads or every 3 minutes.

## Configuration

Edit `config.py` to customize:
- `twitter_search_queries` — 30 default queries for People Search
- `google_dork_templates` — 5 dork patterns with `{role}` placeholder
- `google_dork_roles` — 14 roles plugged into dork templates
- `seed_viral_urls` — starting viral post URLs
- `viral_discovery_queries` — queries to find new viral posts
- `cycle_pause` — seconds between cycles (default: 10)
- `scroll_delay` / `between_profiles_delay` — rate limiting

## Architecture

```
main.py    → Infinite while-loop, StrategyRotator picks missions, Runner.run_streamed() per cycle
agent.py   → Single LeadHunter agent with all 16 tools, GPT-4o-mini
tools.py   → Browser tools (AgentQL + Playwright), search tools, data management
config.py  → Strategy pools, rate limits, thresholds
models.py  → Pydantic lead model + LeadStore with dedup
```
