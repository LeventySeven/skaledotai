# Outreach Service

Background DM sending via a dedicated Render web service. Built to solve the timeout problem — sending 50 DMs takes up to 39 minutes with rate limiting, which kills any serverless or even long-running Next.js request.

## Why a separate service?

The old approach sent DMs inline inside a tRPC mutation. That worked for 2-3 DMs but broke at scale because:

- X rate limits: 15 DMs per 15 minutes, so we delay 62s between sends after the initial burst
- A 50-lead batch takes ~39 minutes — no HTTP request survives that
- If the request dies mid-batch, there's no record of what was sent vs what wasn't

## Architecture

```
┌─────────────┐     1. enqueueDms        ┌──────────────┐
│             │ ──────(tRPC)──────────▶  │   Postgres   │
│   Browser   │                          │  dm_batches  │
│             │     2. POST /session     │   dm_jobs    │
│             │ ──────(Next.js)─────┐    └──────────────┘
│             │                     │           │
│             │  ◀── { token, url } ┘           │
│             │                                 │
│             │     3. POST /dm/send            │
│             │ ──────(direct)──────▶  ┌────────┴───────┐
│             │                        │    Outreach    │
│             │  ◀── NDJSON stream     │    Service     │
│             │      progress events   │  (Render Docker)│
└─────────────┘                        └────────────────┘
```

**Step 1 — Enqueue (fast, server-side)**
tRPC `enqueueDms` mutation inserts a `dm_batches` row and individual `dm_jobs` rows. Returns `batchId`. This is just DB writes — takes milliseconds.

**Step 2 — Get session token**
Client calls `POST /api/outreach/session`. Next.js verifies the user session, creates a short-lived HMAC JWT, returns it with the service URL. Same pattern as multiagent.

**Step 3 — Stream**
Client calls the outreach service directly with the token and `batchId`. The service processes DMs one by one, streaming NDJSON progress events back. The client shows real-time "Sending… 3/47" in the button.

### Key difference from multiagent

Multiagent **cancels on disconnect** — if the user navigates away, the search stops. Makes sense because search results are useless if nobody's watching.

Outreach **keeps going on disconnect** — you can't unsend a DM. If the user closes the tab, the service finishes the batch. They can come back and poll `GET /dm/status/:batchId` to see what happened.

### Crash recovery

On startup, the service queries for batches stuck in `status: "processing"` (meaning the service crashed mid-batch) and resumes them. Jobs already marked `"sent"` are skipped — only `"pending"` ones are retried.

## Rate limiting strategy

Follows X API limits (15 requests per 15-minute window per user):

| Phase | Delay | Why |
|-------|-------|-----|
| First 12 DMs | 3s between sends | Burst window — 15 slots available |
| After 12 | 62s between sends | Sustained ~1/min to stay under 15/15min |
| On 403 | No delay | Recipient-specific (blocked/DMs disabled), doesn't consume rate limit |
| On 429 | Stop | Rate limited — remaining jobs marked `"queued"` for later retry |
| On 401 | Stop | Auth expired — all remaining jobs fail, user needs to reconnect X |

## DB tables

**dm_batches** — one row per send action
- `id`, `userId`, `status` (pending → processing → completed/failed), `totalCount`, `sentCount`, `failedCount`, `createdAt`, `completedAt`

**dm_jobs** — one row per DM
- `id`, `batchId`, `userId`, `leadId`, `xUserId`, `message`
- `status` (pending → sending → sent/failed/queued), `error`, `retryable`, `attemptCount`
- `dmEventId`, `dmConversationId` (from X API response), `sentAt`

## Files

```
services/outreach-service/
  server.ts              ← HTTP server: /dm/send, /dm/status/:id, /healthz
  Dockerfile             ← Bun build → Node.js runtime (same as multiagent)

src/lib/
  outreach-service-auth.ts      ← JWT create/verify (HMAC-SHA256)
  outreach-service-client.ts    ← Client: fetch session, stream NDJSON
  validations/outreach-service.ts ← Session response schema

src/server/services/
  dm-queue.ts            ← enqueueDmBatch() — inserts batch + jobs into DB

src/app/api/outreach/session/
  route.ts               ← Token dispenser (checks user session, returns JWT + URL)
```

## Env vars

**Outreach service (Render Docker service):**
- `DATABASE_URL` — same Postgres as the web app
- `OUTREACH_SERVICE_SHARED_SECRET` — shared with the web app for JWT signing
- `X_CLIENT_ID` — for token refresh
- `PORT` — Render sets automatically

**Web app (add to existing Render service):**
- `OUTREACH_SERVICE_SHARED_SECRET` — same value as above
- `OUTREACH_SERVICE_URL` — e.g. `https://outreach-service-xxxx.onrender.com`
- `OUTREACH_ALLOWED_ORIGINS` — your app domain

## What's not done yet

**Retry for rate-limited jobs.** When a 429 hits, remaining jobs get `status: "queued"` in the DB but nothing picks them up automatically. Options:
- Add a periodic loop in the service that checks for `queued` jobs
- Or a Render cron job that calls a retry endpoint

**Production DB migration.** Tables exist in dev but need `db:prod:push`.
