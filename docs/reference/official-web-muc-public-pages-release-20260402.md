---
doc_type: reference
status: historical
created: 2026-04-02
updated: 2026-04-12
---

# Official Web `muc_public_pages` First Release Snapshot (Historical)

## 文档边界

本文只保留 `2026-04-02` 首次 `official_web/muc_public_pages` registry-backed release 的历史快照。

本文回答的是：

- 首次 mixed-bridge release 当时闭合了什么
- 当时 release 出来的 collection 质量大致处于什么水平
- 为什么这份记录现在只能算历史背景，而不是 active baseline

本文不负责：

- 充当当前 `official_web` 活动基线
- 充当当前 release runbook
- 证明 `muc_public_pages` 已开放 retrieval / query serving

当前应优先阅读：

- `official-web-stable-reference-eval-baseline-20260405.md`
- `official-web-fresh-news-surface-handoff.md`
- `docs/runbooks/official-web-source-truth-projection-replay.md`

## Historical Snapshot

当时执行的 runtime truth：

- runtime profile：`configs/ingestion/official_web/muc_public_pages/runtime-profile.json`
- serving stage：`offline_preparation`
- retrieval enabled：`false`
- serving alias：`muc_public_pages`

当时闭合的 release 结果：

- preflight release：`r20260402_152018`
- published release：`r20260402_152206`
- published physical collection：`muc_public_pages__r20260402_152206`
- validation status：`passed`
- document count：`1`
- point count：`42`

## Historical Quality Interpretation

这次 release 虽然证明了 release plumbing 已经跑通，但当时导入的数据仍明显偏向 listing/news 聚合页，而不是稳定说明型正文页。

历史特征固定为：

- 只有 `1` 条逻辑文档进入 release truth
- chunk 数为 `42`
- 样本内容以新闻聚合页前缀和 listing 片段为主

因此，这轮 release 的历史意义是：

- mixed-bridge collection 的 alias / validation / release lifecycle 已经在工程上跑通
- 但真正的问题仍在内容质量，而不是 release plumbing

## 历史结论

- `official_web/muc_public_pages` 的首条 registry-backed release 路径已经在 `2026-04-02` 跑通
- 这并不代表 mixed bridge 已具备 retrieval readiness
- 后续工作的重点随后转向 fixed-scope clean/chunking、stable-reference split 和 fresh-news handoff；相关口径已迁移到 active reference，不再维护在这里
