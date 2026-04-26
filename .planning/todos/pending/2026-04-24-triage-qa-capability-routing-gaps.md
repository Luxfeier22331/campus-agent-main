---
created: 2026-04-24T08:57:38+08:00
title: 梳理问答能力面与路由缺口
area: planning
owner: supervisor-api
priority: backlog-after-app-api
files:
  - docs/reference/qa-assistant-and-harness-gap-review.md
  - docs/architecture/current-architecture.md
  - docs/architecture/target-architecture.md
  - docs/architecture/system/execution-and-agents-architecture.md
  - apps/supervisor-api/internal/runtimepolicy/
  - apps/supervisor-api/internal/structuredplanning/
  - configs/runtime/intent-policy.v1.json
  - .planning/workstreams/campus-services-notices-runtime-admission/STATE.md
  - .planning/workstreams/restricted-document-rollout-verification/README.md
---

## Problem

2026-04-24 gap review 确认：当前问答助手仍是受控知识问答子集。
query-enabled surface 只有 `regulations/student_rules` 与
`curriculum/curriculum_plan`；通知、服务状态、校内导航、restricted docs、
fresh news 与 live-assisted retrieval 仍处于 offline / deferred /
fail-close posture。

当前 Go `apps/supervisor-api` 已拥有 runtime policy 与 structured planner；
后续缺口不应恢复 Python-side routing，而应围绕 Go-owned policy artifact、
structured runtime opening gate 与 agent handoff observability 做 triage。

当前不进入 app-api-first scope；保留为 supervisor-api / capability routing backlog。

## Solution

后续恢复时先做 planning triage，不直接实现：

1. 对照 `docs/reference/qa-assistant-and-harness-gap-review.md` 的 QA-001 /
   QA-002，列出当前产品需要恢复的 capability family。
2. 把每个缺口归入已有 route：
   - structured runtime opening / query implementation
   - restricted document rollout
   - campus navigation rollout
   - official-web news opening
3. 对 `apps/supervisor-api/internal/runtimepolicy` 与
   `apps/supervisor-api/internal/structuredplanning` 做 fail-close audit，确认哪些
   signal 只是 admission helper，哪些需要升级成 code-owned policy / typed routing
   artifact。
4. 不把 query-disabled surface 临时打开；只有 backing query implementation、
   release-gate evidence 与 typed observability 同时成立时才进入 opening。
