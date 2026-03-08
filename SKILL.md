# Lead Outreach Dashboard — API Skill

You have full programmatic control over Mark's lead outreach dashboard. You can search for leads, manage the CRM, queue people for outreach, and track DMs and replies.

## Setup

**Base URL:** `https://mark-nine-sepia.vercel.app/api/v1`

**Auth:** Every request needs: `x-api-key: <key>`

The key is generated in the dashboard under Settings.

---

## What You Can Do

- **Find leads** — search Twitter or LinkedIn by keyword, or scrape someone's followers
- **Read the lead database** — filter by platform, search by name/bio, filter by outreach queue
- **Update any lead** — set priority (P0/P1), write notes ("the ask"), mark as comfortable to DM, add email
- **Enrich emails** — extract emails from bios for free, or use LinkedIn enrichment ($0.05/found)
- **Manage the outreach queue** — add/remove leads, mark as DMed, mark as replied

---

## Endpoints

### `GET /api/v1/leads` — Read leads

Query params:

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `platform` | `twitter` \| `linkedin` \| `all` | `all` | |
| `search` | string | — | Searches name and bio |
| `inOutreach` | `true` \| `false` | — | Filter by queue status |
| `page` | number | `1` | |
| `pageSize` | number | `25` | Max per page |
| `sort` | `followers-desc` \| `followers-asc` \| `name-asc` | `followers-desc` | |

**Response:** `{ leads: Lead[], total: number }`

---

### `POST /api/v1/leads/search` — Find new leads via scraping

```json
{
  "query": "product designer",
  "platform": "twitter",
  "followersOf": "naval"
}
```

- `query` — required. What to search for.
- `platform` — `"twitter"`, `"linkedin"`, or `"both"`
- `followersOf` — optional Twitter handle. If set, scrapes that account's followers instead of keyword search.

Leads are saved to the database automatically.

**Response:** `{ leads: Lead[] }`

---

### `PATCH /api/v1/leads/:id` — Update a lead's CRM fields

All fields optional:

```json
{
  "priority": "P0",
  "dmComfort": true,
  "theAsk": "Collab on a video",
  "hasDmed": false,
  "replied": false,
  "inOutreach": true,
  "email": "jane@example.com"
}
```

**Response:** `{ ok: true }`

---

### `POST /api/v1/leads/enrich` — Find emails

Tries bio first (free), then LinkedIn enrichment (paid).

```json
{
  "leads": [
    { "id": "uuid", "bio": "reach me at jane@...", "linkedinUrl": "https://linkedin.com/in/..." }
  ]
}
```

**Response:** `{ emails: { "<id>": "<email>" } }`

---

### `POST /api/v1/outreach` — Manage outreach status

```json
{ "id": "lead-uuid", "action": "queue" }
```

| Action | What it does |
|--------|--------------|
| `queue` | Adds lead to the outreach queue |
| `unqueue` | Removes from queue |
| `mark-dmed` | Marks as DMed |
| `mark-replied` | Marks as replied |

**Response:** `{ ok: true }`

---

## Lead Object

```typescript
{
  id: string              // UUID — use this for all updates
  name: string
  handle: string          // "@username" on Twitter, slug on LinkedIn
  bio: string
  platform: "twitter" | "linkedin"
  followers: number
  following?: number
  avatarUrl?: string
  profileUrl?: string
  linkedinUrl?: string
  email?: string

  // CRM
  priority: "P0" | "P1"  // P0 = top priority
  dmComfort: boolean      // comfortable DMing this person?
  theAsk: string          // what to ask them
  hasDmed: boolean
  replied: boolean
  inOutreach: boolean     // currently in the outreach queue

  createdAt?: string
}
```

---

## Example Workflows

### Find and prioritize leads
```bash
# Search for leads
curl -X POST -H "x-api-key: sk_..." -H "Content-Type: application/json" \
  -d '{"query":"indie hacker","platform":"twitter"}' \
  https://mark-nine-sepia.vercel.app/api/v1/leads/search

# Read back, sorted by followers
curl -H "x-api-key: sk_..." \
  "https://mark-nine-sepia.vercel.app/api/v1/leads?platform=twitter&pageSize=50"

# Mark top lead as P0, set the ask, add to queue
curl -X PATCH -H "x-api-key: sk_..." -H "Content-Type: application/json" \
  -d '{"priority":"P0","dmComfort":true,"theAsk":"Collab on podcast","inOutreach":true}' \
  https://mark-nine-sepia.vercel.app/api/v1/leads/<id>
```

### Work the outreach queue
```bash
# See who's in the queue
curl -H "x-api-key: sk_..." \
  "https://mark-nine-sepia.vercel.app/api/v1/leads?inOutreach=true"

# After DMing someone
curl -X POST -H "x-api-key: sk_..." -H "Content-Type: application/json" \
  -d '{"id":"<id>","action":"mark-dmed"}' \
  https://mark-nine-sepia.vercel.app/api/v1/outreach

# They replied
curl -X POST -H "x-api-key: sk_..." -H "Content-Type: application/json" \
  -d '{"id":"<id>","action":"mark-replied"}' \
  https://mark-nine-sepia.vercel.app/api/v1/outreach
```

### Scrape someone's followers
```bash
curl -X POST -H "x-api-key: sk_..." -H "Content-Type: application/json" \
  -d '{"query":"followers","platform":"twitter","followersOf":"levelsio"}' \
  https://mark-nine-sepia.vercel.app/api/v1/leads/search
```
