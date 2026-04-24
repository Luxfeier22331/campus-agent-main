---
created: 2026-04-24T09:34:00+08:00
title: 审计 QA harness 前置可观测性
area: observability
owner: app-api
priority: app-api-first
files:
  - docs/reference/qa-assistant-and-harness-gap-review.md
  - docs/architecture/system/operator-observability-architecture.md
  - .planning/workstreams/operator-observability-control-plane/STATE.md
  - apps/app-api/src/
  - packages/supervisor-core/src/campus_supervisor_core/
  - packages/rag-agent/src/campus_rag_agent/
  - packages/retrieval-core/src/campus_retrieval_core/
---

## Problem

`operator-observability-control-plane` 已完成 request projection、Quality /
Safety / Cost / Audit domains、badcase queue、sampled grade backflow 与真实
staging/sink evidence。但 QA harness 设计前还需要确认这些观测输入足以支撑
answer replay、route / handoff 归因、guardrail verdict 与 badcase-to-eval
回流。

这个缺口不是重新打开一个完整 observability workstream，而是做面向 QA
harness 的前置审计。

当前执行顺序固定为 app-api-first：先确认 app-owned projections / queues /
grade backflow / trace backlink 是否足够，再决定是否 admission 其他层面的
follow-up。

## Solution

后续恢复时做 targeted audit，不新增第二套 operator truth：

1. 列出一次回答 replay 所需的最小字段，并核对 app-api、supervisor、
   rag-agent、retrieval activity 是否都有稳定 correlation。
2. 核对 badcase queue 是否携带 route、handoff、guardrail、evidence 与
   answer verdict 的归因字段。
3. 核对 sampled grading backflow 是否足以生成 eval candidate intake。
4. 核对 future structured runtime / agentic retrieval summary 是否保留
   fail-close、business outcome 与 source family。
5. 只在发现字段缺口时 admission follow-up，不提前设计 QA harness contract。

## 2026-04-24 App-API Execution Progress

- `apps/app-api` 已补齐 operator-safe answer replay read model，来源仍是
  request projection、request observability fact、audit summary 与 trace backlink。
- badcase queue 已补齐 grounding / unsupported evidence / policy / authz /
  freshness fail-close 的 app-owned runtime monitor 分类。
- sampled grade 与 trace backlink 已能通过
  `GET /api/operator/quality/eval-candidates` 导出为 eval candidate intake；eval review
  与 golden admission 仍保留给 eval layer。
