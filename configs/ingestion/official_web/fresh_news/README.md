# fresh_news collection config

This directory holds the repo-tracked runtime profile for the `fresh_news`
collection within the `official_web` corpus.

- source-level crawl ownership remains under
  `configs/sources/official_web/muc_public/`
- this collection is the future freshness-sensitive news serving scope for
  `official_web`

Current runtime truth:

- serving stage: `offline_preparation`
- serving surface: `fresh_news`
- query enabled: `false`
- freshness-sensitive queries supported: `false`
- live-search expansion allowed: `false`
- split manifest required: `true`
- required metadata fields: `published_at`, `crawled_at`, `last_seen_at`,
  `host`, `page_family`, `section`, `news_kind`
- primary evidence page families: `article_detail`
- listing-page role: `discovery_only`
- freshness gate required before any future opening: `true`
- duplicate collapse required before any future opening: `true`
- serving alias: `official_web_fresh_news`
- collection prefix: `official_web_fresh_news`
- repo-tracked split manifest:
  `configs/ingestion/official_web/fresh_news/split-manifest.v1.json`
- repo-tracked retrieval qrels: the eval-langfuse-owned
  `official_web_fresh_news` retrieval dataset

Boundary notes:

- this collection is reserved for news, notices, activities, lectures, and
  media-style public-web content
- even after import/release exists, this surface is not allowed to answer `今天 /
  最新 / 最近` style asks until a separate freshness gate is proven
- the current handoff input is explicit source-truth / source-pack evidence;
  admitting it into `official_web/fresh_news` requires a release-gate path and
  is not driven by broad projection routing
- declaring this profile and baseline does not mean the collection is already
  query-ready
- listing pages remain discovery/freshness-trigger/navigation-only hints; they
  are not primary news evidence
- opening acceptance, recent-news eval matrix, and independent worktree handoff
  now follow `docs/architecture/domains/official-web/serving-and-news-retrieval-strategy.md`
