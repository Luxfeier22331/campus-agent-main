# fresh_news 集合配置

本目录定义离线 `official_web/fresh_news` collection，用于新闻、通知、活动、讲座等时效敏感的
公开网页内容。

## 当前边界

- `serving-config.json` 为 `offline_preparation`，retrieval 关闭；
- 该 collection 不在 `configs/runtime/query-serving-targets.v1.json` 中，`knowledge_query`
  不能选择或搜索它；
- 不存在 live-search fallback；
- article detail page 可以作为 evidence candidate，listing page 只用于 discovery；
- materialized record 必须保留 `published_at`、`crawled_at`、`last_seen_at`、host、page family、
  section 与 news kind metadata。

## 采集

该 collection 没有可执行 task registry。`official_web.capture` 只生成 source artifact 与 URL
freshness state。仓库不为尚未实现的 notice normalization、publication 或 serving admission
保留占位 task 与 query target。
