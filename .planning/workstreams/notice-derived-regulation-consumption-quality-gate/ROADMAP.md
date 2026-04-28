---
doc_type: roadmap
status: active
created: 2026-04-28
updated: 2026-04-28
---
# Roadmap: Notice-Derived Regulation Consumption Quality Gate

<!-- markdownlint-disable MD013 -->

## Overview

固定执行顺序：

```text
admission/cleanup
-> promotion eligibility contract
-> selected cohort audit
-> target materialization contract
-> docs/RAG consumption contract
-> full-text recovery lane
-> acceptance freeze
```

## Phases

- [x] **Phase 0: Admission And 187233 Cleanup** — 新建 workstream，记录 `187233`
  负样本，清理错误 `institutional_rules` / docs read-model / bucket references，并用
  selected projection rebuild 证明其仅保留 notice-level query。
- [x] **Phase 1: Promotion Eligibility Contract** — 将 `full regulation body`
  与 `amendment summary / wrapper notice / reference-only owner` 的判断固化到 promotion
  contract、fixtures 与 routing notes。
- [x] **Phase 2: Selected Cohort Audit** — 对 regulation-like notice 抽样/全量 selected
  cohort 做分类：full-text, scoped-rule, attachment-backed, file-release-backed,
  amendment-summary-only, reference-only, missing-owner。
- [x] **Phase 3: Target Materialization Contract** — 确保 `institutional_rules` /
  `scoped_rules` materializers 只读通过 promotion gate 的 projection truth，且
  rejected/held cases 不产生 target rows。
- [x] **Phase 4: Docs And RAG Consumption Contract** — 明确文档站、docs read-model、
  RAG/chunk-prep 只能消费 target canonical document；低优先级或 partial notice 只提供
  title/url/card。
- [ ] **Phase 5: Full-Text Recovery Lane** — 为缺失完整制度正文的 notice 建立恢复口径：
  file_release / attachment / official-web / existing regulation registry owner lookup，不用
  LLM 编造正文。
- [ ] **Phase 6: Acceptance Freeze And Closeout** — 冻结 selected cohort evidence、
  negative fixtures、PG/bucket audit、dry-run/import/runbook，并定义 reopening rule。

## Stop Point

Phase 6 的 stop point 是：

- regulation notice consumption quality gate 已可重复验证；
- selected accepted documents 可以安全进入 document site / RAG offline preparation；
- rejected/held notice 不会写入 target regulation collections；
- 真实入口 release/query-serving 是否打开仍由后续 product-path workstream 决定。

## Reopen Rule

完成后仅在以下情况恢复：

- 新 regulation-like notice family 被 admission 到 target consumption；
- ADR-0035 或 regulation/scoped-rule target boundary 被改写；
- 文档站/RAG 准备从 offline_preparation 提升到真实用户入口；
- PG/bucket/reference audit 发现 partial notice 再次进入 `regulations/*`。
