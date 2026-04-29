---
doc_type: phase_plan
phase: "6"
phase_name: "Workflow Trace Runtime Gate And Artifact Adoption"
status: completed
created: 2026-04-29
updated: 2026-04-29
---

# Phase 6 Plan: Workflow Trace Runtime Gate And Artifact Adoption

## Objective

把 `workflow_trace` 从 contract/scaffold 推进到真实 runtime gate。

本 phase 要让 Go direct branch、Python delegate、structured runtime tool、guardrail、
routing clarification 与 fail-close terminal outcome 都能投影成同一份 sanitized eval
artifact，并可被 deterministic gate 比对。

## Entry Conditions

- Phase 5A completed.
- `workflow_trace_summary` 与 `orchestration_case_results` shape 已冻结。
- supervisor-api / agent worker 已能提供 request correlation、runtime version、policy
  artifact version 与 selected target/tool summary。

## Scope

- 落地 workflow trace case model 与 fixture family。
- 对齐 `run-XX-case-results.json` 的 workflow trace fields。
- 为 direct structured branch、delegate branch、clarification branch 与 fail-close branch
  各建最小 denominator。
- 建立 deterministic verdict：
  - `direct_vs_delegate_branch_correctness`
  - `handoff_correctness`
  - `tool_argument_precision`
  - `guardrail_correctness`
  - `fail_close_correctness`
  - `trace_projection_completeness`

## Non-Goals

- 不改变 supervisor routing policy。
- 不把 external trace provider 的 raw payload 写成 repo canonical truth。
- 不用 final answer quality 代替 workflow trace correctness。

## Exit Criteria

- workflow trace gate 可以作为 eval profile 运行。
- accepted artifact 输出 workflow trace summary 与 orchestration case result。
- raw prompt、raw transcript、provider raw response、JWT、cookies、auth envelope 与 raw
  retrieval dump 不进入 artifact。
