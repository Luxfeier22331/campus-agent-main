---
doc_type: phase_plan
phase: "12"
phase_name: "Agentic Retrieval Plan / Freshness Eval"
status: completed
created: 2026-04-29
updated: 2026-04-29
---

# Phase 12 Plan: Agentic Retrieval Plan / Freshness Eval

## Objective

在 classic retrieval qrels 之外，为 bounded agentic retrieval 建立
plan/freshness/live-branch eval。

## Entry Conditions

- typed retrieval plan、query activity 与 supporting evidence trace 已稳定。
- retrieval owner 已明确哪些 collection/source channel/query mode 被 admitted。
- Phase 6 workflow trace artifact 可承载 retrieval plan summary 与 tool argument summary。

## Scope

- 评估 query decomposition correctness。
- 评估 step-plan appropriateness。
- 评估 compare / current / historical / as_of / freshness branch correctness。
- 评估 live branch fail-close correctness。
- 评估 supporting evidence selection correctness。

## Non-Goals

- 不扩张到 open-web general search。
- 不让 retrieval executor 自主决定 product scope 或 authorization。
- 不用 final answer 通过率掩盖 retrieval plan 错误。

## Exit Criteria

- agentic retrieval eval profile 可以和 classic qrels 分开运行并汇总。
- artifact 能解释 plan 错、evidence 错、freshness branch 错与 final answer 错的
  区别。
- planner/freshness 变更进入 release path 前有独立 eval evidence。
