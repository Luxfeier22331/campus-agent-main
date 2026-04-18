---
created: 2026-04-18T17:06:24.606Z
title: 收口 internal_notice legacy Office 规范化与 downstream metadata truth
area: ingestion
files:
  - packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_projections.py
  - packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_promotion.py
  - packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_materialization.py
  - packages/ingestion-core/src/campus_ingestion_core/internal_notice_scoped_rule_materialization.py
  - tests/ingestion/test_authenticated_notice_source_projections.py
  - tests/ingestion/test_internal_notice_scoped_rule_materialization.py
  - docs/plans/internal-notice-policy-regulation-consumption-implementation.md
  - docs/reference/internal-notice-manual-review-future-query-contract.md
---

## Problem

当前 non-auth `authenticated-notice -> regulation downstream consumption` workstream 已经落成两块真实进展：

1. source projection 已支持 `docx/xls/xlsx` 进入 `text_extractable`，`.doc` 继续 fail-close。
2. `scoped_rules` 的 `school_unit_name` 已按 title-first + fail-close 收紧，避免正文机构短语误抽取。

但这条 workstream 还有一组未正式登记的后续收口项：

1. `.doc` 仍是真实样本主量级缺口，repo 内还没有 canonical 的 legacy Office normalization lane。
2. 目前缺少 worker-owned normalization/provenance contract；如果未来支持 `.doc`，不能把临时本地转换产物伪装成长期 source truth。
3. `.doc` 当前主要以 replay-time exception fail-close，尚未形成 inventory-friendly 的显式 backlog / terminal-outcome 语义。
4. 代码已支持 `xls/xlsx`，但 `docs/plans/internal-notice-policy-regulation-consumption-implementation.md` 仍把它们写成“未完成支持”，产生 planning truth 漂移。
5. 后续增强必须继续停留在 source-projection / metadata hardening / downstream materialization 边界内，不能借机扩到 auth owner recovery、query-serving reopen、embedding/Qdrant/release。

## Solution

按当前 workstream 的后续顺序推进：

1. 先修正文档真相：明确 `xls/xlsx` 已支持、`.doc` 仍未支持，移除过时的 `office_binary_gap` 表述。
2. 冻结 legacy Office normalization contract：
   - `.doc` 只允许通过 worker-owned normalizer 转成 `.docx` 或等价规范化文本后再进入现有 source projection path
   - 保留原始扩展名、normalizer、normalized object key、normalized content hash 等 provenance
   - 长期对象存储语义继续保持 `S3-compatible object storage`
3. 在 `apps/ingestion-worker` 补 canonical worker entry，让 `.doc` 的支持方式是 repo-owned runtime 行为，而不是 ad-hoc 手工转换。
4. 评估是否把 `.doc` 的当前 replay failure 从“直接异常”收口成可盘点的 terminal outcome / backlog evidence；前提是不能引入兼容层或双路径。
5. 保持 promotion/materialization file-type agnostic：`internal_notice` 下游只消费 canonical document，不重新感知原始 Office 类型。
6. 继续保持 `regulations/scoped_rules` 为 `offline_preparation`，不把 metadata hardening 偷偷扩成 future query-serving reopen。

## Current Status

- 2026-04-19 当前 worktree 已完成：
  - `xls/xlsx` source projection 支持
  - `.doc` 显式 fail-close
  - `annual_cycle_rule` / `time_bound_operational_rule` 按 `target_collection` 路由到 `regulations/scoped_rules`
  - `school_unit_name` title-first fail-close 修复与真实误抽取回归覆盖
- 当前判断：这组工作属于同一条 non-auth downstream workstream 的近端 follow-up，应先登记为 pending todo，而不是立即提升成 repo 级新 phase
