---
doc_type: plan
status: planned
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Phase 7 Plan: Acceptance And Closeout

## Goal

证明首期链路已经从已采集内容干净重放到 searchable 与 admitted downstream，并留下后续定时团队可接入的 evidence。

## Tasks

1. 运行 source/search/downstream 数量一致性检查。
2. 验证 historical inventory 和 future live discovery 使用同一 `notice_ingest`
   queue contract。
3. 运行 searchable sample smoke。
4. 运行 regulation/schedule/status sample smoke。
5. 验证 regulation stop point 仍为 `offline_preparation`，未打开 query-serving。
6. 验证 transport schedule image OCR 未绕过 baseline-aware gate。
7. 生成 source-to-queue-to-search-to-downstream trace artifact。
8. 汇总 reset/replay/OCR/downstream evidence。
9. 更新 workstream state 和 closeout 文档。

## Acceptance

- 所有 valid captured notices 可检索。
- 历史库存和未来 live discovery 不存在两条 ingest truth。
- 未 admission notices 没有进入 typed downstream。
- regulation 只停在 gated materialization / offline preparation，未 release / alias publish。
- OCR pending/done/failed 可观测。
- evidence 足以支持后续定时/认证团队接入。
