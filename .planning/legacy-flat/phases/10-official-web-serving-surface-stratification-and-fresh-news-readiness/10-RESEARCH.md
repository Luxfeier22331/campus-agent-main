# Phase 10 Research: Official Web Serving Surface Stratification And Fresh News Readiness

**Date:** 2026-04-04
**Status:** Complete for planning

## What Exists Now

### Runtime truth
- `configs/ingestion/official_web/muc_public_pages/runtime-profile.json` already keeps `official_web/muc_public_pages` in `offline_preparation`
- retrieval is disabled and default query-serving is disabled
- runtime-profile loading already supports collection-specific retrieval policy fields

### Source-truth layer
- `OfficialWebPageManifest` already carries `fetchedAt`, `etag`, `lastModified`, `responseBodyHash`, and `mainContentHash`
- collector extraction already contains rich date-like heuristics, but no canonical `publishedAt` field is persisted
- article/detail fixtures already contain explicit `发布时间` signals that can be normalized deterministically

### Replay/import layer
- replay already shapes projection-unit metadata such as `page_family`, `document_kind`, `serving_intent`, and `semantic_content_hash`
- import already reuses projected metadata; no extra import-only transformation is required to preserve new unit metadata

### Retrieval / answer layer
- official-web already has low-signal fail-close rules and title-targeted document-diversity policies
- current answer shaping for official-web is stable for targeted title/reference queries
- there is not yet a first-class fail-close rule for freshness-sensitive wording like `今天` / `最新` / `最近`

## What Is Stable

- Current `official_web/muc_public_pages` chunk structure is acceptable for the current imported truth
- Stable-reference-like targeted queries already have locked eval coverage
- `official_web` remains offline by default, which gives room to tighten policy without breaking a live default surface

## What Is Still Unstable

### 1. Freshness metadata is missing from canonical source truth

The collector can detect dates, but the repo still does not persist one canonical publication timestamp for detail pages.

That means later fresh-news routing would have to guess from body text or headers again.

### 2. Runtime truth does not explicitly encode freshness-sensitive answer policy

The current runtime profile says `offline_preparation`, but it does not yet say:

- whether the surface is freshness-ready
- whether `今天/最新/最近` style queries are supported
- whether live-search fallback is allowed

### 3. Eval truth does not yet lock the freshness fail-close branch

Current official-web release-gate cases cover targeted reference/news questions and low-signal no-answer, but not freshness-sensitive no-answer.

## Recommended Phase Breakdown

### Plan 10-01
Freeze runtime/profile semantics and current collection README truth.

Expected outputs:
- runtime-profile fields for serving-surface/freshness policy
- profile loader/tests updated
- collection README updated to reflect current offline + mixed-surface truth

### Plan 10-02
Add canonical publication-time extraction and propagate metadata downstream.

Expected outputs:
- `publishedAt` in source-truth manifest
- deterministic extraction tests for date and datetime cases
- projection metadata includes `published_at` / `fetched_at` and related fields

### Plan 10-03
Fail-close freshness-sensitive official-web queries and lock eval coverage.

Expected outputs:
- official-web freshness-sensitive query policy in retrieval/answer path
- scope-specific no-answer wording for freshness-sensitive official-web asks
- release-gate eval case proving current truth still refuses freshness-sensitive asks

## Risks To Avoid

- Inferring publication time from generic listing rows or body prose with no explicit page-level metadata context
- Accidentally enabling official-web default query-serving while adding runtime-profile fields
- Treating current mixed `muc_public_pages` truth as if it were already a clean `fresh_news` surface
- Reopening crawl scope or control-plane ownership while only trying to improve current-scope serving correctness
