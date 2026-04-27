---
doc_type: index
status: completed
created: 2026-04-27
updated: 2026-04-27
---

# Workstream: Public Chat Campus Services E2E Acceptance

这是 `public-chat-campus-services-e2e-acceptance` 的 native workstream 入口。
它负责把 public/chat 入口到 `campus-services-agent` structured tools 的产品级 E2E 验收、
release gate 与 opening verdict 收口到同一条线。

## Current Status

- status: `completed`
- completed phase: `Phase 6`
- completion posture: `campus-services-product-path` opening gate 已形成 machine-readable
  artifact；tool-level opening verdict、rollout flags、rollback 条件、source trace 观察点与
  owner handoff 已落盘到 architecture/runbook/workstream summary
- reopen rule: 只有在 campus-services tool denominator 新增、tool-level opening verdict 改写、
  rollout/rollback contract 改写，或 staging opening 证据与当前 verdict 发生漂移时才恢复

## Native Planning Truth

- roadmap: `./ROADMAP.md`
- requirements: `./REQUIREMENTS.md`
- state: `./STATE.md`

## Boundary Notes

- 这条线只验证 public/chat 真实入口、planner/router 选择、agent handoff、tool 消费与最终回答呈现
- 这条线不重开 ingestion source-truth、notice consumption projection 或 PG structured projection 架构
- 这条线不替代 `apps/supervisor-api/internal/structuredquery` 的 unit/integration tests
- 这条线不把 `campus-services-agent` 扩成通用 RAG 或 notice text search owner
- 这条线不重新设计 `service_status_lookup`、`transport_schedule_lookup`、
  `service_guide_lookup` 或 `contact_directory_lookup` 的 source-truth / projection owner；
  只验证这些 tool 经过 public/chat 产品路径后的 routing、answer、trace 与 fail-close 行为

## Related Workstreams

- `campus-services-runtime-tool-gap-closeout`
  - 提供 tool-level deterministic denominator 与 runtime readiness closeout
  - 本 workstream 消费其结果，不替代它的 tool kernel / projection readiness 工作
