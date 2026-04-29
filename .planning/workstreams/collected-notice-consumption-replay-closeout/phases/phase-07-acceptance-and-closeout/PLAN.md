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
2. 运行 searchable sample smoke。
3. 运行 regulation/schedule/status sample smoke。
4. 生成 source-to-search-to-downstream trace artifact。
5. 汇总 reset/replay/OCR/downstream evidence。
6. 更新 workstream state 和 closeout 文档。

## Acceptance

- 所有 valid captured notices 可检索。
- 未 admission notices 没有进入 typed downstream。
- OCR pending/done/failed 可观测。
- evidence 足以支持后续定时/认证团队接入。
