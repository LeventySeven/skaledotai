# skaleai

`skaleai` is a Next.js application for discovering, organizing, scoring, and preparing outreach to X/Twitter leads.

The app is opinionated around one workflow:

1. Pick an X data provider.
2. Search for relevant X accounts or import a seed account's network.
3. Store those profiles as leads inside a project.
4. Refresh post stats and AI-derived priority signals.
5. Queue leads for outreach and generate reusable outreach templates.
6. Run AI analysis across multiple projects to create a new shortlist project.

## What the product does

The current codebase implements five major product areas:

- Search: discover leads by niche query or by searching within a seed account's followers.
- Projects: organize leads into project buckets and run AI analysis across projects.
- Leads: store CRM-style lead records, edit pipeline fields, and track outreach state.
- Outreach: manage the outreach queue and generate/save message templates.
- Settings: choose the global X data source and manage API keys.

The application is not a generic social CRM. It is specifically structured around X/Twitter lead discovery and lightweight operator workflows.

## Core workflows

### 1. Search and add leads

The user runs `search.run` through the Search page.

- The selected global X provider is sent in the `x-data-provider` header.
- The backend asks the provider layer for discovery candidates.
- The search service deduplicates and over-collects candidates.
- OpenAI is used to expand queries when recall is too low.
- OpenAI is also used as a screening layer to keep plausible leads and reject obvious junk.
- Canonical profile lookups run through the same provider when supported.
- The final profiles are upserted into `leads`.
- The selected project is created or reused, then linked through `project_leads`.
- A provider run is recorded in `project_runs`.

### 2. Import an account network

The user runs `search.importNetwork`.

- The seed account is resolved by username.
- Followers and following are fetched page by page through the selected provider.
- Profiles are deduplicated and inserted as leads.
- The import is linked to a project and recorded in `project_runs`.

### 3. Refresh stats and priority

The user runs `stats.refresh`.

- The selected provider fetches recent tweets for a lead.
- Metrics are aggregated into averages.
- OpenAI extracts topics and returns a `P0` / `P1` priority recommendation.
- `post_stats` is upserted.
- The lead priority can also be updated in `leads`.

### 4. Analyze projects into a new shortlist

The user runs `projects.analyze`.

- Leads from multiple source projects are loaded and deduplicated.
- Existing `post_stats` are reused when present.
- Missing stats can be refreshed from the selected provider.
- The analysis service computes heuristic scores, then asks OpenAI to select the best subset.
- A brand new project is created and the shortlisted leads are attached to it.

### 5. Generate outreach templates

The user runs `outreach.generateTemplate`.

- Leads are collected from selected projects and/or explicit lead IDs.
- Existing post stats and topics are used as messaging context.
- OpenAI creates a compact outreach template.
- The generated template is persisted in `outreach_templates`.

## Tech stack

- Framework: Next.js 16 App Router
- UI: React 19
- Styling: Tailwind CSS 4
- Components: local UI primitives built on `@base-ui/react`
- API layer: tRPC v11
- Validation: Zod
- Serialization: SuperJSON
- Auth: Better Auth with email/password and Google sign-in
- Database: Postgres via Drizzle ORM
- Query client: TanStack Query
- AI: OpenAI Responses API
- X provider integrations:
  - native X API
  - Apify
  - Oxylabs
  - Multi-Agent pipeline (LangGraph + Tavily + AgentQL + OpenAI)
  - OpenRouter
- Tooling: Bun for tests and database scripts

## Repository layout

- `src/app`: Next.js routes, layouts, auth actions, and API route handlers
- `src/components`: page workspaces, hooks, sidebar, provider selectors, and UI primitives
- `src/server/trpc`: tRPC context, router composition, and route definitions
- `src/server/services`: business logic and database workflows
- `src/lib/x`: X provider contracts, adapters, discovery logic, and error mapping
- `src/lib/openai.ts`: AI ranking, screening, analysis, and template generation helpers
- `src/db`: Drizzle schema, migrations, and DB connection
- `tests`: unit and integration coverage

## Current backend surface

The app exposes:

- `/api/auth/[...all]`: Better Auth HTTP route
- `/api/trpc/[trpc]`: tRPC fetch adapter route

There is currently no first-class `/api/v1/*` REST surface in the repository. The settings copy mentions API-key usage, but the implemented backend surface is tRPC plus Better Auth.

## Database model

Main application tables:

- `projects`: user-owned project containers
- `leads`: CRM lead records scoped per user
- `project_leads`: project-to-lead join table
- `project_runs`: per-project provider run metadata
- `post_stats`: cached tweet activity aggregates per lead
- `outreach_templates`: saved generated/manual templates
- `api_keys`: hashed API keys

Better Auth tables:

- `user`
- `session`
- `account`
- `verification`

## X provider model

The selected provider is global on the client and is forwarded on every tRPC request.

Supported providers today:

- `x-api`
- `apify`
- `multiagent`
- `openrouter`

Capability support differs by provider:

- Full search/lookup/network/tweets: `x-api`, `apify`
- No network support: `multiagent`
- Discovery-only style provider: `openrouter`

The backend does not silently switch to a different provider. Unsupported capabilities raise explicit runtime errors.

## Multi-agent worker deployment

`multiagent` can be deployed as a separate Render service using `render.yaml` and `services/multiagent-service/Dockerfile`.

App-side env:

- `MULTIAGENT_SERVICE_URL`
- `MULTIAGENT_SERVICE_SHARED_SECRET`

Render worker env:

- `DATABASE_URL`
- `OPENAI_API_KEY`
- `OPENAI_MODEL` or `MULTIAGENT_PLANNER_MODEL`
- `TAVILY_API_KEY`
- `AGENTQL_API_KEY`
- `MULTIAGENT_SERVICE_SHARED_SECRET`
- `MULTIAGENT_ALLOWED_ORIGINS`

The app mints a short-lived signed token, and the browser streams `multiagent` NDJSON events directly from Render. That keeps the live reasoning UI intact without holding a Vercel function open for the full run.

## Important implementation notes

- Leads are unique per `userId + handle + platform`.
- `project_runs` is upserted using a derived `request_key`.
- AI features are best-effort and degrade to deterministic fallbacks when OpenAI is unavailable.
- Multi-Agent is bounded deliberately:
  - limited search query fan-out
  - limited discovered URL count
  - limited scrape concurrency
  - partial tolerance for upstream AgentQL failures

## Development commands

```bash
bun dev
bun test
bun test:unit
bun test:integration
bun run build
```

Database workflow:

```bash
bun run db:generate
bun run db:migrate
bun run db:push
```

The repository also contains [`memory/migrations.md`](./memory/migrations.md), which documents the expected migration workflow used in this project.

## Environment requirements

Core environment variables:

- `DATABASE_URL`
- `BETTER_AUTH_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Provider-specific variables:

- `X_API_BEARER_TOKEN`
- `APIFY_TOKEN`
- `OXYLABS_USERNAME`
- `OXYLABS_PASSWORD`
- `OXYLABS_FIXTURE_READY`
- `OPENAI_API_KEY`
- `TAVILY_API_KEY`
- `AGENTQL_API_KEY`
- `OPENROUTER_API_KEY`

Optional provider/model tuning:

- `OPENAI_MODEL`
- `OPENAI_REASONING_EFFORT`
- `MULTIAGENT_PLANNER_MODEL`
- `OPENROUTER_X_DISCOVERY_MODEL`
- `OPENROUTER_SITE_URL`
- `OPENROUTER_APP_NAME`
- `X_ENABLE_FULL_ARCHIVE`

## Tests and verification

The repository includes:

- schema and validation tests
- provider request builder tests
- service integration tests with mocked DB/provider boundaries
- build verification through `next build`

For the full implementation breakdown, see [`CURRENT_ARCHITECTURE.md`](./CURRENT_ARCHITECTURE.md).
