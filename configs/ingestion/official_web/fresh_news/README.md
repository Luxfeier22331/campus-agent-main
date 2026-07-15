# fresh_news collection

This directory defines the offline `official_web/fresh_news` collection for
news, notices, activities, lectures, and other freshness-sensitive public web
content.

## Current Boundary

- `serving-config.json` is `offline_preparation` with retrieval disabled.
- The collection is absent from
  `configs/runtime/query-serving-targets.v1.json`; `knowledge_query` cannot
  select or search it.
- There is no live-search fallback.
- Article detail pages are evidence candidates; listing pages are discovery
  inputs only.
- Materialized records must preserve `published_at`, `crawled_at`,
  `last_seen_at`, host, page family, section, and news kind metadata.

## Ingestion

This collection has no executable task registry. `official_web.capture` only
produces source artifacts and URL freshness state. Notice normalization,
publication, and serving admission will be defined by the notice redesign; no
placeholder ingestion task or query target is kept here.
