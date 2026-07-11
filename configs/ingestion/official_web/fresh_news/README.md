# fresh_news collection config

This directory holds the repo-tracked serving config for the `fresh_news`
collection within the `official_web` corpus.

- source-level crawl ownership remains under
  `configs/sources/official_web/muc_public/`
- this collection profile is the reserved intent-scoped freshness-sensitive news
  serving scope for `official_web`

Reserved profile declaration:

- serving stage: reserved `query_serving` profile; not query-ready without a
  full publish path
- serving surface: `fresh_news`
- retrieval policy: intended profile only until source admission and release
  path exist
- query enabled by default: `false`
- freshness-sensitive queries supported: `true`
- online serving: disabled; this offline collection has no live-search fallback
  and is absent from the active query-serving scopes
- split manifest required: `true`
- required metadata fields: `published_at`, `crawled_at`, `last_seen_at`,
  `host`, `page_family`, `section`, `news_kind`
- primary evidence page families: `article_detail`
- listing-page role: `discovery_only`
- freshness gate required: `true`
- duplicate collapse required: `true`
- serving alias: `official_web_fresh_news`
- collection prefix: `official_web_fresh_news`
- repo-tracked split manifest:
  `configs/ingestion/official_web/fresh_news/split-manifest.v1.json`
- repo-tracked retrieval qrels: the eval-langfuse-owned
  `official_web_fresh_news` retrieval dataset

Boundary notes:

- this collection is reserved for news, notices, activities, lectures, and
  media-style public-web content
- this surface is not part of default official-web RAG; it requires explicit
  freshness intent and query-serving scope admission
- even after import/release exists, this surface is not allowed to answer `今天 /
  最新 / 最近` style asks until a separate freshness gate is proven
- the current handoff input is explicit source-truth / source-pack evidence;
  admitting it into `official_web/fresh_news` requires a release-gate path and
  is not driven by broad projection routing
- declaring this profile and baseline does not mean the collection is already
  query-ready
- current `muc_public` notice/news target is `inventory_only`; this profile must
  not be read as an opened `fresh_news` ingestion or runtime surface
- listing pages remain discovery/freshness-trigger/navigation-only hints; they
  are not primary news evidence
- opening semantics now follow `docs/architecture/system/retrieval-serving.md`
  and `configs/runtime/query-serving-scopes.v3.json`
