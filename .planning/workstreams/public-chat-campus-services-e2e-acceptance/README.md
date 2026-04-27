---
doc_type: index
status: active
created: 2026-04-27
updated: 2026-04-27
---

# Workstream: Public Chat Campus Services E2E Acceptance

这是 `public-chat-campus-services-e2e-acceptance` 的 native active workstream 入口。
它负责把 public/chat 入口到 `campus-services-agent` structured tools 的产品级 E2E 验收、
release gate 与 opening verdict 收口到同一条线。

## Current Status

- status: `active`
- current phase: `Phase 4`
- current slice: fail-close, clarification, and no-action guardrails
- current posture: internal structured query、agent adapter 与部分 tool release gate 已有 focused
  验证；public/chat 入口已具备 deterministic Worker harness、campus-services preflight、
  tool-level positive routing matrix，以及 answer rendering / source trace acceptance，
  下一步进入 fail-close / clarification / no-action guardrail

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
