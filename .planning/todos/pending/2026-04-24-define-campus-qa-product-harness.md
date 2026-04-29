---
created: 2026-04-24T08:57:38+08:00
title: 定义校园问答产品 harness
area: architecture
owner: architecture
priority: backlog-after-app-api
files:
  - docs/reference/qa-assistant-and-harness-gap-review.md
  - docs/architecture/system/operator-observability-architecture.md
  - docs/architecture/system/prompt-and-instruction-architecture.md
  - docs/reference/eval-gold-truth-model.md
  - docs/reference/eval-benchmark-artifact-contract.md
  - packages/contracts/src/campus_contracts/
---

## Problem

2026-04-24 gap review 确认：校园问答助手需要产品级 harness，但当前还没有
明确 contract 描述一次回答如何被 trace、复盘、评级、进入 eval 或转成后续
修复任务。

现有能力分散在 request projection、operator observability、prompt metadata、
release gate 与 eval artifact 中；它们还不是一个明确的 answer-quality
harness。

但 harness contract 不应先于基础层冻结。当前应先补齐 eval governance 与
observability QA prerequisite，再进入本任务。

当前不进入 app-api-first scope；它是 app-api 缺口收口后的后置 architecture
backlog。

## Solution

后续恢复时只有在以下前置任务完成后，才做 design contract，不直接改 runtime：

- `.planning/todos/pending/2026-04-24-complete-eval-governance-prereqs.md`
- `.planning/todos/pending/2026-04-24-audit-observability-qa-prereqs.md`

1. 定义 `CampusQaHarnessRecord` 或等价 reference model，覆盖 request id、
   actor projection summary、capability route、handoff、guardrail verdict、
   evidence summary、answer verdict 与 follow-up action。
2. 明确哪些字段属于 tracked eval truth，哪些只允许存在于 operator/runtime
   observability，不把敏感 trace 原文写进 repo。
3. 对齐 `eval`、operator observability、prompt metadata 与 request projection
   的 ownership，避免新增一套平行 truth。
4. 用 `student_rules` 与 `curriculum_plan` 各选一个真实 replay case 验证模型可用。
