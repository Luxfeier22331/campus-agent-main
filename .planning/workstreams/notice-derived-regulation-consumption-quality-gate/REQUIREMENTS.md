---
doc_type: requirements
status: active
created: 2026-04-28
updated: 2026-04-28
---
# Requirements: Notice-Derived Regulation Consumption Quality Gate

<!-- markdownlint-disable MD013 -->

## Goal

建立 regulation-like internal notice 从 source-truth 到下游 consumption 的质量门：

- 只有完整、可独立消费的制度正文进入 `regulations/institutional_rules`
- 年度/批次/临时规则只进入合适的 scoped target
- 修订摘要、发布壳、引用关系、缺失 owner 的 notice 保留在 notice consumption 面或进入恢复 lane
- 文档站/RAG 只消费通过 target quality gate 的 canonical document

## In Scope

- authenticated internal notice 的 regulation-like 分流与 promotion eligibility
- parent notice 清壳后的 full-text 判断
- attachment/file-release/official-web owner evidence 与缺失 owner fail-close
- `regulations/institutional_rules` / `regulations/scoped_rules` materialization gate
- selected cohort dry-run、formal import、docs read-model 与 PG/bucket reference audit
- negative fixtures，包括 `187233`

## Out Of Scope

- 不重开 authenticated live portal 采集窗口
- 不把 source-truth bytes 搬入 Postgres
- 不在 query-time 扫 raw notice body 生成制度答案
- 不打开 release/query-serving alias；是否开放用户入口由后续 product-path gate 决定
- 不把 incomplete amendment notice 通过 LLM 改写成制度正文

## Required Invariants

- `regulations/*` only stores canonical regulation/scoped-rule text, not wrapper notice text
- `notice_level_query` 可以保留 title/url/card 检索，但不能伪装成完整制度文档
- `promotion_candidate` 必须有 full-text evidence 或明确 owner document
- `partial_amendment_summary` 必须 fail closed
- source notice must remain in `campus_notices/internal_notice`
- all target rows must preserve source notice/document/attachment/file-release provenance

## Success Criteria

- `187233` 不再出现在 `regulations/institutional_rules` registry/docs/read-model/bucket refs
- selected dry-run for `187233` returns zero materialized target documents
- positive fixtures with embedded full article text still promote correctly
- attachment-backed and scoped-rule cases keep existing acceptance behavior
- promotion report exposes why a notice was held or routed to recovery
- docs/RAG import refuses empty or partial regulation body
