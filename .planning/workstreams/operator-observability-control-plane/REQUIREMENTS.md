---
doc_type: requirements
status: deferred
created: 2026-04-19
updated: 2026-04-19
---

# Requirements: Operator Observability Control Plane

## Goal

在 `apps/app-api` owned operator truth 上，补齐 request-scoped observability fact、audit projection、aggregate APIs、panel 新域与 sink participation / grading backflow。

## In Scope

- request-scoped observability foundation
- audit projection
- metric rollup 与 aggregate APIs
- `protected-panel-web` 的 `Overview / Quality / Safety/Authz / Cost / Audit` 扩面
- `Sentry` / `Axiom` / grading 的 sink participation 与 app-owned 回流

## Non-goals

- 当前已开放 surface 的三端验收
- panel 直读 raw sink 或 raw audit log
- 为单个 dashboard 设计视觉细节

## Success Criteria

1. `app-api` 持续是 operator-facing read-model owner。
2. panel 通过 app-owned rollup / projection 消费 observability truth，不回退成 sink viewer。
3. aggregate APIs 覆盖 `Overview / Quality / Safety/Authz / Cost / Audit`。
4. sink participation 只作为输入或回流，不直接替代 canonical truth。

## Canonical Entry

- `docs/plans/operator-observability-control-plane-foundation.md`
