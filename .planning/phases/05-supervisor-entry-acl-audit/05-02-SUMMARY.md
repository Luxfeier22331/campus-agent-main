---
phase: 05-supervisor-entry-acl-audit
plan: "02"
subsystem: supervisor-entry
tags: [actor, acl, trusted-worker, specialist-handoff]
completed: 2026-03-27
---

# Phase 05 Plan 02 Summary

补上了真实 caller actor 到 retrieval ACL seam 的传播链路。

- `trusted-worker` 在验证 origin trust 后，从 `cf-access-jwt-assertion` 提取 caller identity / groups / roles claims
- 这些字段会进入 `SupervisorRequest.actor`，并继续到 `SpecialistRequest.actor`
- 已用 API 与 supervisor tests 锁定传播行为
