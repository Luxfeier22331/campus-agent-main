# news_archive collection config

This directory holds the repo-tracked runtime profile for the `news_archive`
collection within the `official_web` corpus.

- source-level crawl ownership remains under
  `configs/sources/official_web/muc_public/`
- this collection is the future archive surface for historical official-web news
  content

Current runtime truth:

- serving stage: `offline_preparation`
- serving surface: `news_archive`
- query enabled: `false`
- freshness-sensitive queries supported: `false`
- live-search expansion allowed: `false`
- required metadata fields: `published_at`, `crawled_at`, `last_seen_at`,
  `host`, `page_family`, `section`, `news_kind`
- primary evidence page families: `article_detail`
- listing-page role: `discovery_only`
- explicit historical intent required before any future opening: `true`
- duplicate collapse required before any future opening: `true`
- serving alias: `official_web_news_archive`
- collection prefix: `official_web_news_archive`

Boundary notes:

- this collection is reserved for historical news that should not share the
  default answer contract of `fresh_news`
- it is not the default online official-web answer surface
- it must not silently backfill recent-news asks or freshness failures
- listing pages remain discovery/navigation hints only; they are not archive
  primary evidence
- declaring this profile does not mean archive routing, retention policy, or
  archive-specific retrieval behavior has already been implemented
- opening acceptance and handoff now follow
  `docs/architecture/domains/official-web/serving-and-news-retrieval-strategy.md`
