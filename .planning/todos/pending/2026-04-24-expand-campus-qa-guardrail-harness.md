---
created: 2026-04-24T08:57:38+08:00
title: 扩展校园问答 guardrail harness
area: testing
owner: eval-supervisor-rag-agent
priority: backlog-after-app-api
files:
  - docs/reference/qa-assistant-and-harness-gap-review.md
  - docs/architecture/system/prompt-and-instruction-architecture.md
  - docs/architecture/system/identity-and-authorization-architecture.md
  - packages/evals/
  - packages/supervisor-core/src/campus_supervisor_core/
  - packages/rag-agent/src/campus_rag_agent/
---

## Problem

2026-04-24 gap review 确认：问答助手已有 scope / evidence / policy
fail-close 方向，但产品 harness 还需要系统覆盖 out-of-scope、
unsupported-by-evidence、restricted allow/deny/no-leak、prompt injection、
capability misroute、freshness-sensitive answer 与高风险校园政策表述。

这些不是普通 answer correctness case 能完整覆盖的质量维度。

当前不进入 app-api-first scope；保留为非 app-api backlog。

## Solution

后续恢复时扩展 eval / regression，而不是只加 prompt 文案：

1. 为每类 guardrail 建立最小 golden cases 与 expected machine verdict。
2. 区分“应该回答”“应该澄清”“应该拒答”“应该转 capability”的期望结果。
3. 覆盖 retrieved content 中的 prompt injection 与 untrusted evidence payload。
4. 与 restricted rollout 一起验证 memory 不提权、deny path 不泄漏。
