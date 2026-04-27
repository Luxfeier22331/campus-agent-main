---
doc_type: state
status: backlog
created: 2026-04-27
updated: 2026-04-27
---

# State: Public Chat Campus Services E2E Acceptance

## Current Status

- status: `backlog`
- current slice: none
- owner: unassigned
- active implementation: no

## Captured Context

2026-04-27 代码与 smoke 确认：

- `service_status_lookup` 已能从 PG current release 返回 `353903` 的 `status_note`。
- `transport_schedule_lookup` 已能在班次结果里附带 `353903` 的 `operational_notices`。
- `service_guide_lookup` 已能消费 notice-derived 地铁接驳车预约说明。
- 当前验证主要覆盖 internal structured query endpoint 与 `campus-services-agent` adapter focused tests。
- public/chat 真实入口 E2E 尚未固化为 backlog / release gate。

## Acceptance Prompts To Preserve

- “丰台校区通勤班车在哪里上车”
- “通勤班车丰台校区乘车点现在在哪里”
- “2月24日丰台回海淀最早的班车是几点”
- “地铁接驳车怎么预约”
- “校园卡丢了怎么办”

## Expected Tool Routing

- 乘车点、开放状态、临时关闭、当前运营调整 -> `service_status_lookup`
- 班车时刻、下一班、首班、末班、时刻表版本 -> `transport_schedule_lookup`
- 预约说明、办理流程、材料、入口、办公时间、联系方式 -> `service_guide_lookup`

## Blockers

- 需要决定 public/chat E2E 运行目标：local only、staging，或两者都做。
- 需要确认测试身份与 capability flags。
- 需要确认当前 shared PG projection readiness 是否作为 E2E preflight。

## Verification

- backlog 登记本身不执行 E2E。
- 恢复为 active 后，至少需要覆盖 public-chat-web/app-api/supervisor-api 的真实请求路径、planner selected tool、agent response、最终 answer text 与 source trace。

## Continuity Notes

- 不要把这条线变成 ingestion 或 projection rebuild 工作。
- 首个 active slice 应先做 E2E harness 与 fixture prompts，再讨论是否加入 CI/staging release gate。
- 失败判断必须区分 planner 路由失败、tool fail-close、projection 缺数据、最终回答渲染失败。
