# Plan: Expand Lead Search Capacity and Make Selection Reasons Explicit

## Summary
- Keep the current `StateGraph` architecture and formalize specialist subgraphs instead of refactoring to the supervisor package.
- Move lead selection from a mostly opaque post-discovery filter into an explicit selection/evidence phase that runs during search and persists structured reasoning for every kept lead.
- Change lead count from a hard cap to a soft target: accept any integer input, raise the supported target to `300`, and allow the final result to exceed the request within a controlled overrun buffer.
- Use NIA in the engineering pipeline, not the end-user runtime: docs subscription, code-vs-doc checks, deep research, and cross-agent context handoff.

## Key Changes
- Extend the search pipeline with a provider-agnostic selection graph after discovery/canonicalization. Add three explicit subagents:
  - `profile_signal_extractor`: pulls alignment signals from `name`, `handle`, `bio`, location, and audience stats.
  - `post_signal_extractor`: pulls 1-2 concrete X post excerpts that support fit.
  - `lead_selector`: ranks candidates, applies the soft-target policy, and emits persisted reasoning.
- Keep the existing discovery graph for `multiagent`, but scale its budgets by requested size instead of fixed small caps.
  - `targetLeadCount`: accept any integer `1..300`.
  - `goalCount`: keep `max(20, ceil(targetLeadCount * 1.35))`.
  - Raise the candidate-pool ceiling to `720`.
  - Replace fixed multiagent discovery limits with size-sensitive formulas:
    - query budget: `3` for `<60`, `4` for `<120`, `6` for `<220`, `8` otherwise.
    - URL budget: `clamp(12, 96, ceil(goalCount * 0.22))`.
    - scrape batch size: `clamp(3, 12, ceil(urlBudget / 6))`.
- Make “Approximate leads” a soft target instead of a hard max.
  - Screening keeps all accepted candidates above the acceptance threshold until `requested + max(5, ceil(requested * 0.15))`.
  - If accepted candidates are still below the request, backfill from lower-score included candidates until the request is met or the pool is exhausted.
  - Trace/UI copy should explicitly say the request is approximate and that the result may be higher.
- Expand persisted lead reasoning.
  - Add structured `evidence` to the persisted insight model as JSON/JSONB entries with `source`, `snippet`, and `whyItAligns`.
  - `source` values: `name`, `handle`, `bio`, `post`, `audience`.
  - Update the public reasoning types to expose `evidence` alongside `summary`, `alignmentBullets`, `userGoals`, `confidence`, `tools`, and `subagents`.
  - Generate this during search for every selected lead using query + profile fields + up to 2 sample posts + available audience/post stats.
  - Keep `getLeadReasoning` as the read API, but make it return persisted search-time evidence first and only regenerate for legacy rows with missing structured evidence.
- Update the lead detail UI to show:
  - exact matched snippets from name/handle/bio,
  - exact matched post excerpts,
  - the specific user goal each snippet supports.
- Stream the new selection/evidence phases into the existing reasoning panel so the search trace shows where discovery ended and why final leads were kept.
- Add a repo-local agent-engineering workflow that uses NIA for ongoing pipeline improvement:
  - subscribe/index LangGraph and related official sources once,
  - use `nia.search`/`nia_read`/`nia_grep` for targeted doc lookup,
  - use `nia_advisor` before orchestration/prompt changes,
  - save experiment findings and eval outcomes with `nia.context`,
  - use Oracle research only for larger architecture investigations.

## Public API / Type Changes
- `SearchLeadInput.targetLeadCount`: change from stepped `20..180` behavior to integer `1..300`.
- `LeadReasoningResult` and persisted `LeadReasoning`: add `evidence: Array<{ source: "name" | "handle" | "bio" | "post" | "audience"; snippet: string; whyItAligns: string }>` and keep current fields intact.
- Screening result contract: extend from selected IDs only to selected IDs plus per-selected structured evidence and score.

## Test Plan
- Validation tests:
  - accept `1`, `137`, and `300`;
  - reject `0` and `301`;
  - confirm UI input no longer enforces step-10 increments.
- Search-service tests:
  - requested count is treated as a soft target, not a hard max;
  - result can exceed the request within the overrun buffer;
  - larger requests increase graph budgets and candidate ceilings deterministically.
- Multiagent graph tests:
  - new selection/evidence subagent steps appear in streamed trace order;
  - recovery and validator behavior remain intact for low-yield/rate-limit paths.
- Reasoning tests:
  - persisted insights include `name`/`handle`/`bio`/`post` evidence when available;
  - `getLeadReasoning` serves persisted evidence for fresh runs and backfills legacy rows.
- UI tests:
  - lead detail renders grouped evidence snippets;
  - search trace copy explains soft target semantics.

## Assumptions
- No new external lead-discovery provider is added in this iteration; improvements stay within the current OpenAI, Tavily, AgentQL, X API, and TwitterAPI.io stack.
- NIA is used to improve the engineering and evaluation pipeline, not as a live dependency inside end-user lead search requests.
- The existing lead detail sheet remains the primary place to inspect “why this lead”; no separate reasoning column is added to the table in this pass.
- The current LangGraph supervisor dependency can remain installed, but it is not adopted as the orchestration model for this change.

## Research Basis
- [LangGraph workflows and agents](https://docs.langchain.com/oss/javascript/langgraph/workflows-agents): supports workflow-first orchestration, parallel branches, streaming, and explicit graph state.
- [LangGraph subgraphs](https://docs.langchain.com/oss/javascript/langgraph/use-subgraphs): recommends subgraphs for reusable specialist workflows with isolated persistence behavior.
- [LangChain subagents](https://docs.langchain.com/oss/javascript/langchain/multi-agent/subagents): supervisor-style subagents are best when a central agent truly needs tool-like specialists and context isolation.
- [NIA overview](https://docs.trynia.ai/) and [pre-indexed sources](https://docs.trynia.ai/pre-indexed-sources): support using indexed docs as the default research surface instead of repeated ad hoc web lookup.
- [NIA context sharing](https://docs.trynia.ai/context-sharing) and [Oracle research](https://docs.trynia.ai/oracle-research): support persistent experiment handoff and deeper architecture research when needed.
- [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents): recommends using the simplest workable architecture first and adding agent complexity only when it buys flexibility.
- [Microsoft AI agent orchestration patterns](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns): reinforces workflow-first orchestration, selective parallelism, checkpointing, and coordination-cost awareness.
- [Google Vertex AI agent evaluation](https://cloud.google.com/vertex-ai/generative-ai/docs/models/evaluation-agents): supports adding explicit trajectory and final-response evaluation for agent pipelines.
