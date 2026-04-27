---
doc_type: roadmap
status: backlog
created: 2026-04-27
updated: 2026-04-27
---

# Roadmap: Public Chat Campus Services E2E Acceptance

当前为 backlog draft，不代表 active execution order。恢复为 active workstream 前，应确认 public chat deployment target、capability flags、test account/session 与 shared PG projection readiness。

## Phase 1: E2E Harness And Environment Gate

**Goal:** 固化 public/chat 入口 E2E 的本地与 staging 运行条件。

**Scope:**
- public-chat-web / app-api / supervisor-api 联调启动方式
- `campus_services` capability gate 与 structured query shared secret
- shared PG current release readiness checks
- test account/session or anonymous mode requirements

## Phase 2: Planner And Tool Routing Acceptance

**Goal:** 验证真实用户问法稳定路由到 `campus-services-agent` 的正确 tool。

**Scope:**
- 乘车点 / 开放状态 -> `service_status_lookup`
- 通勤班车 / 接驳车时刻 -> `transport_schedule_lookup`
- 预约、办理流程、材料、入口 -> `service_guide_lookup`
- 明确防止误路由到 notice generic text search 或 rag-specialist

## Phase 3: Answer Rendering And Source Trace Acceptance

**Goal:** 验证最终 public chat 回答可用、可追溯、不过度暴露内部状态。

**Scope:**
- structured result 转自然语言回答
- `status_note` / `operational_notices` 的产品化摘要
- source refs / notice refs 的可见性策略
- fail-close / clarification UX

## Phase 4: Regression Dataset And Release Gate

**Goal:** 将 campus services product-path E2E 纳入可重复 eval/smoke。

**Scope:**
- golden prompts for transport schedule, service status, service guide
- expected tool, expected outcome, required answer facts
- negative cases for unsupported services and ambiguous routes
- CI/staging gate decision
