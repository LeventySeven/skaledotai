## TurboPuffer Lead Memory Integration

### Summary
- Add a dedicated high-quality lead memory layer backed by Postgres plus a TurboPuffer mirror. Postgres stays canonical; TurboPuffer is the retrieval layer.
- Follow TurboPuffer’s documented patterns: per-isolated namespace, `upsert_rows` for full document writes, strong-consistency queries, vector plus BM25 `multi_query`, and app-owned rank fusion. Docs basis: [Quickstart](https://turbopuffer.com/docs/quickstart), [Write](https://turbopuffer.com/docs/write), [Query](https://turbopuffer.com/docs/query), [Hybrid](https://turbopuffer.com/docs/hybrid), [Vector](https://turbopuffer.com/docs/vector), [Namespaces](https://turbopuffer.com/docs/namespaces).
- Retrieval policy: search TurboPuffer first, merge and dedupe those hits with fresh Twitter discovery, and only top up the shortfall. If memory alone satisfies the target, skip extra Twitter work.

### Key Changes
- Add a new canonical table `lead_memories` instead of repurposing unused `internal_leads`.
  - Business columns: `name`, `social`, `deliverables`, `url`, `email`, `price` stored as `price_cents`, `tags`, `relevancy`.
  - Sync/search columns: `source_lead_id`, `project_id`, `handle`, `bio`, `profile_url`, `followers`, `following`, `quality_reason`, `created_at`, `updated_at`, `last_synced_at`.
  - Unique key: `(user_id, social)`.
- Add `src/server/services/lead-memory.ts` plus a TurboPuffer client wrapper.
  - Init from `TURBOPUFFER_API_KEY`, `TURBOPUFFER_REGION`, optional namespace prefix.
  - Namespace strategy: one namespace per user, sanitized to TurboPuffer’s allowed charset and length.
  - Centralize `upsertLeadMemoryRows`, `searchLeadMemory`, `mapMemoryHitToCandidate`, and `buildLeadMemorySearchText`.
- TurboPuffer document schema:
  - Store the requested 8 business fields plus internal `search_text`, `updated_at`, `source_lead_id`, and `vector`.
  - `tags` and `deliverables`: `[]string` with BM25 enabled.
  - `relevancy`, `price_cents`, `updated_at`, `source_lead_id`, and `social`: filterable.
  - `email`, `url`, and long descriptive text: non-filterable unless needed later.
  - Explicit vector schema for the chosen embedding dimension; use full document upserts when synced fields affect embeddings.
- Add an extraction and embedding boundary.
  - New helper derives `deliverables`, `tags`, and `relevancy` from profile data, posts, and stored reasoning, with heuristic fallback.
  - Embedding model default: `text-embedding-3-small`.
  - High-quality threshold default: `relevancy >= 70`; only those records sync immediately.
- Integrate into `src/server/services/search.ts`.
  - Run lead-memory lookup before provider discovery.
  - Fuse vector and BM25 results client-side with reciprocal-rank fusion, map hits back into candidate records, seed `knownHandles`, and reduce remaining target before Twitter discovery starts.
  - After accepted leads are inserted into the project, upsert qualifying rows into `lead_memories` and mirror them to TurboPuffer.
  - If TurboPuffer fails, emit a warning step/log and continue with the current search path.
- Integrate into `src/lib/x/multiagent.ts` as a first-class source.
  - Add a `lead_memory` node after `planner`.
  - Query TurboPuffer using `normalizedQuery`, `roleTerms`, and `bioTerms`; merge hits into graph state before `people_search`.
  - If memory hits already satisfy `goalCount`, route straight to validation/end; otherwise continue with People Search, Grok, Tavily, and scraping.
- Observability and trace behavior.
  - Reuse existing `step` and `traceData` machinery; do not add a new stream event type.
  - Add structured logs for `[lead-memory][lookup] start|hit|miss|error` and `[lead-memory][upsert] success|error`.
  - Include `userId`, `projectId`, `query`, `namespace`, `hitCount`, `remainingTarget`, `latencyMs`, `topScore`, and `errorCode`.
  - Add a visible trace step like `Lead Memory Lookup` so live runs clearly show found vs not found.

### Public API / Type Changes
- Add `lead_memories` DB schema and mapper types.
- Add `LeadMemoryDocument` and `LeadMemoryHit` service types.
- Extend `DiscoverySourceSchema` and `XLeadCandidate.discoverySource` with `turbopuffer_memory`.
- Keep TRPC route shapes and `SearchRunStreamEvent` unchanged; only trace contents gain the new step.

### Test Plan
- Unit: namespace sanitization, TurboPuffer schema builder, query builder, rank fusion, hit-to-candidate mapping, high-quality gating, graceful error handling.
- Integration: memory hit only skips extra discovery, partial hits top up via Twitter, miss preserves current behavior, accepted leads sync into Postgres plus TurboPuffer, and the next strong-consistency lookup sees the new rows immediately.
- Multi-agent: `lead_memory` node emits trace steps, contributes candidates, and can satisfy the goal without entering the rest of the discovery branches.
- Regression: existing x-api and multiagent search tests still pass when TurboPuffer is disabled or unconfigured.

### Assumptions
- TurboPuffer is a mirror store, not the canonical DB.
- One namespace per user is the tenancy model.
- Search policy is merge first, then top up shortfall.
- `social` maps to the normalized X handle for the current Twitter-first pipeline; `url` stores the full profile or external site URL.
- Unknown `deliverables`, `email`, and `price` are allowed to remain empty until later enrichment.
- No historical backfill in v1; only newly accepted high-quality leads are synced.
- `internal_leads` stays untouched in v1.
- Future DM-based replenishment reuses the same full-upsert helper, since TurboPuffer vector fields are not patch-updated in place.
