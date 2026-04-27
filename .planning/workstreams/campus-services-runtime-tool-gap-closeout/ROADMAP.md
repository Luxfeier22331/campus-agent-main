---
doc_type: roadmap
status: active
created: 2026-04-27
updated: 2026-04-27
---

# Roadmap: Campus Services Runtime Tool Gap Closeout

当前 workstream 已恢复执行。Phase 6 handoff 后，四个首发 tool 的 local opening verdict
已是 `open`；本路线图用于继续收口 runtime denominator、answer shaping 与真实部署证据。

## Phase 1: Service Status Lookup Readiness Closeout

**Status:** active

**Goal:** 收口当前状态、临时调整、乘车点变更、开放 / 关闭类问题的 runtime 可用性。

**Scope:**

- subject alias 与 canonical service mapping
- 临时调整、常规状态、历史记录与 source conflict precedence
- `status_note` answer shaping
- source trace / observability summary
- planner/router + structured query + agent adapter deterministic eval

## Phase 2: Transport Schedule Lookup Readiness Closeout

**Goal:** 收口班车 / 接驳车时刻、方向、首末班、下一班与运营窗口类问题的 runtime 可用性。

**Scope:**

- route / direction / stop alias coverage
- 长期线路、临时线路、临时站点调整与 schedule exception precedence
- date / time semantics，包括节假日、周末、寒暑假、下一班与 projection window fail-close
- operational notices answer shaping
- schedule how-to 问题必须路由到 `service_guide_lookup`
- deterministic eval denominator

## Phase 3: Service Guide Lookup Readiness Closeout

**Goal:** 收口怎么办、材料、入口、办公时间、预约说明类只读指南问题的 runtime 可用性。

**Scope:**

- service guide catalog 与 alias coverage
- guide section normalization：procedure、materials、entry、office hours、audience、
  contact refs
- 事务 guardrail：不生成预约、提交、代办、支付或工单 handoff
- source refs、更新时间、适用范围与 clarification / unavailable rendering
- deterministic eval denominator

## Phase 4: Contact Directory Lookup Readiness Closeout

**Goal:** 收口部门电话、邮箱、办公地点、联系人与办公时间类稳定联系方式问题的 runtime 可用性。

**Scope:**

- department / office / service / role alias coverage
- ambiguity clarification 与 privacy / conflict / non-ready fail-close
- phone / email / location / hours answer shaping
- transaction guardrail：不生成打电话、发邮件、代联系等执行动作
- deterministic eval denominator

## Phase 5: Shared Runtime Tool Opening Gate

**Goal:** 为四个 tool 提供统一 release gate 输入，供 public/chat E2E workstream 消费。

**Scope:**

- planner/router expected target + allowed tool cases
- structured query expected facts / fail-close cases
- campus-services-agent answer shaping cases
- safe source trace requirements
- handoff to `public-chat-campus-services-e2e-acceptance`
