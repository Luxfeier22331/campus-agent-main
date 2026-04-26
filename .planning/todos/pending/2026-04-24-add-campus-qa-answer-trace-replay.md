---
created: 2026-04-24T08:57:38+08:00
title: 增加校园问答回答 trace replay
area: backend
owner: app-api
priority: app-api-first
files:
  - docs/reference/qa-assistant-and-harness-gap-review.md
  - docs/architecture/system/operator-observability-architecture.md
  - docs/data/retrieval-query-activity-model.md
  - apps/app-api/src/modules/runtime-command/
  - apps/supervisor-api/internal/httpapi/
  - apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/
  - packages/rag-agent/src/campus_rag_agent/
---

## Problem

2026-04-24 gap review 确认：问答链路已有 request projection、prompt metadata、
retrieval activity 与 operator observability 基础，但单次回答还不能稳定形成
完整 replay artifact。

坏回答复盘时，需要同时看到 admission、capability routing、handoff、retrieval
plan/support selection、guardrail verdict、answer finalization 与 response
projection。当前这些信息还没有一个足够稳定的产品 harness 视图。

## Solution

后续恢复时先做 app-api projection / redaction / read-model slice，在不暴露 raw
prompt / 敏感 memory / restricted evidence 的前提下推进：

1. 定义 answer trace replay 的最小字段与脱敏规则。
2. 让 Go supervisor runtime、Python agent worker、rag-agent、retrieval activity
   与 app-api projection 共享 stable correlation id。
3. 给 no-answer、clarification、policy refusal、unsupported-by-evidence 与
   deterministic answer path 各补一个 replay sample。
4. 把 replay sample 接入 operator-safe observability，而不是返回给 public chat。

非 app-api 的 route / handoff / retrieval diagnostic 生成逻辑只记录为后续
backlog；本任务先确认 app-api 如何接收、归一化、持久化和投影 typed summary。

## 2026-04-24 App-API Execution Progress

- `GET /api/operator/requests/:requestId/observability` 已新增 `replay` 分段：
  context、routing、execution、retrieval、answerQuality、prompt。
- `replay` 只重组 operator-safe typed summary，不返回 raw prompt、raw answer、
  raw transcript、raw retrieved snippet、raw auth material 或 raw vendor payload。
- supervisor-api / agent worker / rag-agent / retrieval 侧更细的 route、handoff 与
  retrieval diagnostic 生成逻辑仍作为非 app-api 后续任务处理。
