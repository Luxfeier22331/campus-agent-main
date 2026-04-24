---
created: 2026-04-24T08:57:38+08:00
title: 产品化 memory 与 restricted authz
area: backend
owner: app-api
priority: app-api-first
files:
  - docs/reference/qa-assistant-and-harness-gap-review.md
  - docs/architecture/system/identity-and-authorization-architecture.md
  - docs/architecture/target-architecture.md
  - apps/app-api/src/modules/runtime-command/service/writes.ts
  - packages/contracts/src/campus_contracts/models_context.py
  - .planning/workstreams/restricted-document-rollout-verification/README.md
---

## Problem

2026-04-24 gap review 确认：目标态把 truth 拆为 verified identity、
profile memory、session memory、institutional knowledge 与 authorization
truth。当前产品链路已经透传 actor / authorization / session slots，但
`buildSupervisorContextProjection(...)` 里 `profileMemory.items` 仍为空。

这意味着 personalization 仍主要依赖 session slot 和有限 actor claims；
更细粒度角色差异化问答、restricted rollout 的 allow/deny/applicability
口径还没有完整产品化。

## Solution

后续恢复时与 `restricted-document-rollout-verification` 一起设计，不单独从
prompt 层补个性化文案：

1. 明确 `profile memory` 的 owner、写入来源、可见性与过期/验证策略。
2. 保持 memory 只能影响 intent framing、retrieval planning preference 与
   wording；不能授予权限或扩大 retrieval ACL。
3. 给 restricted rollout 增加 allow/deny leakage cases，覆盖 memory 不提权。
4. 在 `app-api` request projection 中记录 memory participation summary，
   但不把敏感 memory 原文暴露给 public response。
