---
doc_type: reference
status: active
created: 2026-04-14
updated: 2026-04-20
---

# Official Web News Surface Opening Checklist

## 文档边界

本文冻结 `official_web/fresh_news` 与 `official_web/news_archive` 的长期
opening contract。

它回答的是：

- 打开任何 news-serving surface 前必须产出哪些 artifact
- 哪些结果不能被误写成 runtime opening success
- promote 到 active rollout 前还需要满足什么

它不表示：

- 当前分支已经打开 news query-serving
- seed import/release 或局部 qrels 已经等于 runtime ready
- 当前 mixed `muc_public_pages` 可以替代 `fresh_news` / `news_archive`

补充规则：

- execution status、单轮 closeout 证据与 rollout 决策继续写回 `.planning/`
- 本文只冻结 opening gate 与 artifact contract，不代替执行状态板

## Opening Artifact Checklist

在任何 news surface 从 `offline_preparation` 走向 active rollout 前，至少必
须保留以下 artifact：

1. opening criteria checklist
   - `fresh_news` / `news_archive` 各自是否满足当前 repo policy
2. metadata coverage summary
   - `published_at`
   - `crawled_at`
   - `last_seen_at`
   - `host`
   - `page_family`
   - `section`
   - `news_kind`
3. duplicate-collapse posture
   - cross-host duplicate 是否已经归并为单一逻辑 document/version
4. eval / live-gate artifact
   - recent-news ask
   - stale-local ask
   - explicit historical ask
   - archive must not backfill recent ask
   - listing-only evidence must not masquerade as article-detail truth
5. promote prerequisites summary
   - 当前 `serving_stage`
   - 是否仍 `query_enabled_by_default=false`
   - 是否允许 live-search fallback
   - 使用了哪个 physical collection / alias

## `fresh_news` Opening Gate

以下条件必须同时成立：

- primary evidence 默认只允许 `article_detail`
- `listing_page` 只承担 discovery / freshness trigger / navigation fallback
- `published_at`、`crawled_at`、`last_seen_at` 已达到可路由、可排序、可 stale 判定
- query routing 已能把稳定说明、近期新闻、显式历史新闻分开
- “今天 / 最新 / 最近 / 刚刚” 会先走 freshness gate
- local freshness 不足时会 live search 或 fail-close
- archive 不会参与 recent-news 默认回填

## `news_archive` Opening Gate

以下条件必须同时成立：

- 仍保持 `query_enabled_by_default=false`
- 只在 explicit historical intent / operator / analysis / eval 场景命中
- recent-news query 不会把 archive 当作隐藏补 recall 库
- answer 会显式保留历史语义与时间锚点
- primary evidence 默认只允许 `article_detail`

## 不能算成功的结果

以下结果都不能作为 handoff success：

- seed import/release 成功
- isolated retrieval qrels 命中率高
- exact-title deterministic live gate 通过
- 单次本地问答看起来“回答得还行”
- hot-lane crawl 频率提高
- 只证明 listing page 能命中

## Promote To Active Rollout 前提

promote 到 active rollout 前，至少需要：

- 本文 checklist 全部满足
- repo policy truth 与本轮 opening artifact 一致
- `fresh_news` / `news_archive` 的 runtime profile 已从占位值推进到真实可执行值
- opening artifact 已写回 `.planning/` handoff truth
- 对当前主分支明确说明：
  - 哪个 surface 打开了
  - 哪个 surface 仍然关闭
  - 哪些 query intent 仍然 fail-close

## 相关文档

- [official-web-serving-and-news-retrieval-strategy.md](/home/reptilian/code/campus-agent/docs/architecture/domains/official-web/serving-and-news-retrieval-strategy.md)
- [official-web-freshness-and-incremental-crawling.md](/home/reptilian/code/campus-agent/docs/architecture/domains/official-web/freshness-and-incremental-crawling.md)
- [official-web-fresh-news-surface-handoff.md](/home/reptilian/code/campus-agent/docs/reference/official-web-fresh-news-surface-handoff.md)
- [official-web-fresh-news-eval-baseline.md](/home/reptilian/code/campus-agent/docs/reference/official-web-fresh-news-eval-baseline.md)
- [official-web-stable-reference-eval-baseline.md](/home/reptilian/code/campus-agent/docs/reference/official-web-stable-reference-eval-baseline.md)
