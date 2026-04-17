---
doc_type: reference
status: completed
created: 2026-04-05
updated: 2026-04-12
---

# Official Web Stable Reference Bootstrap Release Snapshot (Historical)

## 文档边界

本文只保留 `2026-04-04 UTC` 首次 `official_web/stable_reference` bootstrap release 的历史快照。

本文回答的是：

- 首次 routed replay -> import -> registry-backed release 当时产出的核心结果
- 为什么这次执行对后续 active baseline 有历史意义

本文不负责：

- 充当当前 active baseline
- 充当当前 release runbook
- 证明 `stable_reference` 已默认开放 query-serving
- 证明 `fresh_news` / `news_archive` 已闭合

当前应优先阅读：

- active baseline：`official-web-stable-reference-eval-baseline-20260405.md`
- fresh-news handoff：`official-web-fresh-news-surface-handoff.md`
- 执行步骤：`docs/runbooks/official-web-source-truth-projection-replay.md`

## Historical Snapshot

当时执行固定了以下历史事实：

- runtime profile：`configs/ingestion/official_web/stable_reference/runtime-profile.json`
- serving stage：`offline_preparation`
- serving alias：`official_web_stable_reference`
- routed stable-reference subset：`9` 条稳定说明型页面
- 首个 registry-backed release id：`r20260404_204033`
- 首个 physical collection：`official_web_stable_reference__r20260404_204033`
- alias publish 在这次 bootstrap release 时仍然 deferred

## Historical Significance

- 这是 `official_web` 从 mixed bridge 走向 split scope 的第一轮可执行 routed replay/import/release 快照
- 后续 active eval baseline 正是围绕这条 physical collection 建立
- 此后 alias publish 与 live gate 继续沿着同一份 validated document set 进行；相关口径已转移到 active baseline 文档，不再维护在这里

## 历史结论

- `official_web/stable_reference` 的首条真实 routed replay/import/release 路径已经在 `2026-04-04 UTC` 跑通
- 这份文档只保留那次 bootstrap execution 的摘要，不再承担默认入口职责
