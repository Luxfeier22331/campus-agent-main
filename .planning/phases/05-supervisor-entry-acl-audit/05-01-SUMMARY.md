---
phase: 05-supervisor-entry-acl-audit
plan: "01"
subsystem: supervisor-api
tags: [api, supervisor-entry, bearer, actor-mapping]
completed: 2026-03-27
---

# Phase 05 Plan 01 Summary

收紧了 supervisor public entry 的 bearer 身份模型。

- `bearer` 现在只映射 runtime-owned 默认 actor，不再信任客户端提供的 `x-actor-*` 头
- 新增 `API_DEFAULT_ACTOR_ID`
- `.env.example` 与 `apps/supervisor-api/README.md` 已同步
