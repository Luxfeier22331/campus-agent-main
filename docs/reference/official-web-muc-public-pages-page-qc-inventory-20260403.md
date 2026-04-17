---
doc_type: reference
status: historical
created: 2026-04-03
updated: 2026-04-12
---

# Official Web `muc_public_pages` Page QC Inventory Snapshot (Historical)

## 文档边界

本文只保留 `2026-04-03` 那轮 `official_web/muc_public_pages` page-level inventory 的历史分组结果。

本文回答的是：

- 当时 `21` 条 mixed-bridge current truth 被怎样分层
- 哪些页面当时被纳入 answer gate
- 哪些页面后来被明确转去 inventory-only 或 fresh-news handoff

本文不负责：

- 充当当前 active inventory 入口
- 继续维护逐页 QC 台账
- 证明 mixed bridge 仍是当前默认工作面

当前应优先阅读：

- `official-web-fresh-news-surface-handoff.md`
- `official-web-stable-reference-eval-baseline-20260405.md`

## Historical Grouping

当时的 `21` 条 current truth 固定分成三层：

- `release_gate_required = 11`
  - 稳定说明型页面加 2 条高信号 notice / interpretation 页面
- `retain_inventory_only = 2`
  - `访问学者`
  - `干部人事`
- `future_fresh_news_surface = 8`
  - 8 条新闻页

同时，`3` 条低价值 public notice 页面被固定留在 `audit_only`，不进入 current truth。

## Historical Significance

这份历史 inventory 的作用是：

- 首次把 mixed bridge 明确切成“必须 answer-gate”和“只保留 inventory truth”两层
- 首次把 news 页显式移出 stable-reference-like gate，转成后续 `fresh_news` handoff input
- 证明当时已经不再把全部 promotable 页面视为同等可消费材料

## Superseded By

这份 inventory 的 active 口径后来被拆分并收敛到：

- stable / news 边界：`official-web-fresh-news-surface-handoff.md`
- stable-reference eval baseline：`official-web-stable-reference-eval-baseline-20260405.md`

因此本文现在只保留追溯价值，不再作为 active QC 主入口。
