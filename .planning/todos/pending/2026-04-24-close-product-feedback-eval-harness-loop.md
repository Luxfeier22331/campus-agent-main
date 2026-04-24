---
created: 2026-04-24T08:57:38+08:00
title: 打通产品反馈到 eval harness
area: testing
owner: app-api
priority: app-api-first
files:
  - docs/reference/qa-assistant-and-harness-gap-review.md
  - docs/reference/eval-gold-truth-model.md
  - docs/reference/eval-benchmark-artifact-contract.md
  - .planning/workstreams/eval/STATE.md
  - .planning/workstreams/operator-observability-control-plane/STATE.md
---

## Problem

2026-04-24 gap review 确认：产品 runtime 已有 request projection、
operator observability 与 eval substrate，但生产反馈还没有稳定闭环到
golden dataset、badcase queue、release gate 与后续产品修复任务。

当前状态更像三套相邻系统：

- app-api 记录 request / observability truth
- eval workstream 管理 benchmark / artifact / golden dataset
- product harness 管理 trace replay、quality verdict 与 badcase intake

它们之间还缺一条机器可读的 badcase-to-eval-case / eval-case-to-fix loop。

## Solution

后续恢复时先做 app-api-owned badcase / grade / trace backlink / export seam
slice；eval candidate review 与 golden set admission 保留为后续 backlog：

1. 定义 operator grading / badcase record 如何进入 eval candidate intake。
2. 定义哪些 failure class 自动生成 pending todo，哪些只进入 eval backlog。
3. 为 product harness record 增加 request trace backlink，不把敏感 trace 原文写入
   tracked planning truth。
4. 为一次真实 badcase 跑通：operator mark -> eval candidate -> regression
   command -> fix task。

## 2026-04-24 App-API Execution Progress

- `operator.quality_badcase_projection` 的 runtime monitor 分类已覆盖
  `citation_missing`、`empty_recall`、`grounding_failed`、
  `unsupported_by_evidence`、`policy_failed`、`authz_suspected` 与
  `freshness_fail_close`。
- `GET /api/operator/quality/eval-candidates` 已提供只读导出 seam，稳定派生
  `candidateId` 并给出 `suggestedEvalFamily`。
- 本次没有让 `app-api` 写入 golden dataset、release gate 或 fix task；这些仍属于
  eval / QA harness 后续层。
