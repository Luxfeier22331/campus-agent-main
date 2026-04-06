## news_archive collection config

This directory holds the repo-tracked runtime profile for the `news_archive`
collection within the `official_web` corpus.

- source-level crawl ownership remains under
  `configs/sources/official_web/muc_public/`
- this collection is the future archive surface for historical official-web
  news content

Current runtime truth:

- serving stage: `offline_preparation`
- serving surface: `news_archive`
- query enabled: `false`
- freshness-sensitive queries supported: `false`
- live-search fallback allowed: `false`
- serving alias: `official_web_news_archive`
- collection prefix: `official_web_news_archive`

Boundary notes:

- this collection is reserved for historical news that should not share the
  default answer contract of `fresh_news`
- it is not the default online official-web answer surface
- declaring this profile does not mean archive routing, retention policy, or
  archive-specific retrieval behavior has already been implemented
