# Phase 10: Official Web Serving Surface Stratification And Fresh News Readiness - Context

**Gathered:** 2026-04-04
**Status:** Ready for planning and execution
**Source:** Derived from current `official_web` architecture/policy docs, `muc_public_pages` current-truth QC, runtime-profile truth, and the current retrieval / answer / eval implementation

<domain>
## Phase Boundary

Phase 10 is a worktree-local follow-up for `official_web/muc_public_pages`.

Its job is to turn the current repo judgment into explicit executable truth:

- current `muc_public_pages` stays `offline_preparation`
- current collection truth may still power local QC / benchmark / forced validation
- fresh-news readiness must be represented as metadata and fail-close policy, not inferred later from vague page-family heuristics

This phase is intentionally narrower than "open official_web retrieval" or "expand crawl scope".

### In Scope

- Freeze current runtime-profile semantics for a mixed `official_web` collection that is still offline by default
- Add canonical source-truth `publishedAt` extraction for explicit page-level time metadata
- Propagate publication/fetch metadata into replayed projection units and projection reports
- Add freshness-sensitive fail-close behavior for `official_web/muc_public_pages`
- Add eval coverage that locks the new fail-close contract for freshness-sensitive wording

### Out Of Scope

- Expanding host scope or crawl frontier
- Opening `official_web/muc_public_pages` as a default query-enabled collection
- Creating the final `stable_reference` / `fresh_news` / `news_archive` collection split in this phase
- Adding live search fallback or deployed handoff behavior
- Reopening app-api control-plane or scheduler topology

### Success Shape

- The current repo can state, in code and config, that `muc_public_pages` remains offline and not freshness-ready for `今天/最新/最近` style questions
- `official_web` page manifests and projected units carry canonical publication/fetch metadata needed for later fresh-news work
- Freshness-sensitive queries fail closed under the current runtime truth instead of being answered from mixed old local index content
</domain>

<decisions>
## Implementation Decisions

### Locked by current architecture
- `official_web` remains one source channel; serving-surface policy belongs to runtime/profile and answer-path policy, not collector host scope.
- Collector owns source-truth extraction, including publication-time extraction, instead of pushing date recovery into replay/import.
- Replay/import may consume and propagate time metadata, but they must not invent page-level publication truth after the fact.
- `muc_public_pages` stays `offline_preparation`; this phase prepares metadata and fail-close policy without reopening default serving.

### Locked by current worktree truth
- The current chunk audit for imported `official_web/muc_public_pages` is acceptable at structure level; the major remaining gap is serving-surface correctness, not raw chunk format corruption.
- Current `release_gate_required` pages are usable as stable-reference-like truth for targeted questions, but the whole collection is not safe as a generic "latest official web" answer surface.
- Current `future_fresh_news_surface` pages must not be silently reclassified as already-ready default answer truth.

### The agent's discretion
- The exact runtime-profile field names used to express freshness-sensitive query support and surface labeling
- The exact publication-time extraction heuristics, as long as they prefer explicit page-level signals and do not infer dates from generic listing noise
- The exact fail-close wording, as long as it explicitly communicates that current local official-web truth does not support freshness-sensitive answers
</decisions>

<canonical_refs>
## Canonical References

### Repo and planning truth
- `AGENTS.md`
- `README.md`
- `.planning/PROJECT.md`
- `.planning/ROADMAP.md`
- `.planning/STATE.md`

### Official-web architecture and policy
- `docs/architecture/official-web-serving-and-news-retrieval-strategy.md`
- `docs/architecture/official-web-freshness-and-incremental-crawling.md`
- `docs/policies/official-web-cleaning-and-chunking-policy.md`
- `docs/reference/official-web-muc-public-pages-current-truth-qc-20260403.md`
- `docs/reference/official-web-muc-public-pages-page-qc-inventory-20260403.md`

### Runtime / collector / replay / answer code
- `configs/ingestion/official_web/muc_public_pages/runtime-profile.json`
- `packages/ingestion-core/src/campus_ingestion_core/corpus_profiles.py`
- `packages/official-web-core/src/source-truth.ts`
- `apps/official-web-collector/src/page-artifacts.ts`
- `packages/ingestion-core/src/campus_ingestion_core/official_web_projection.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/official_web_projection_import.py`
- `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`
- `packages/rag-specialist/src/campus_rag_specialist/service.py`
- `packages/evals/src/campus_evals/scenarios.py`
</canonical_refs>

<specifics>
## Specific Ideas

- Plan `10-01` should freeze runtime-profile semantics for "mixed current truth, offline by default, freshness-sensitive queries unsupported".
- Plan `10-02` should add `publishedAt` extraction to `OfficialWebPageManifest` and propagate publication/fetch metadata into projected document units.
- Plan `10-03` should fail-close freshness-sensitive official-web queries and add eval coverage, while leaving the collection itself query-disabled by default.
</specifics>

<deferred>
## Deferred Ideas

- Physically splitting `muc_public_pages` into `stable_reference` / `fresh_news` / `news_archive`
- Live-search fallback and freshness gate that depends on deployed control-plane freshness truth
- Query routing across multiple official-web collections
- Broad official-web crawl expansion
</deferred>

---

*Phase: 10-official-web-serving-surface-stratification-and-fresh-news-readiness*
*Context gathered: 2026-04-04*
