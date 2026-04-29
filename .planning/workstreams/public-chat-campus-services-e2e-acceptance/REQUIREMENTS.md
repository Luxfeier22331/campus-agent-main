---
doc_type: requirements
status: active
created: 2026-04-27
updated: 2026-04-27
---

# Requirements: Public Chat Campus Services E2E Acceptance

## Goal

为 `campus-services-agent` 的 structured runtime tools 建立 public/chat 产品路径验收线，
验证真实用户入口能够稳定完成：

`public-chat-web -> app-api -> supervisor-api -> supervisor-agent-worker -> campus-services-agent -> internal structured query`

最终产出 opening verdict：哪些 campus services tools 可以开放，哪些必须继续保持 closed，以及
closed 的具体 owner / blocker。

## In Scope

- public/chat 入口到 `campus-services-agent` 的 E2E harness
- `service_status_lookup`、`transport_schedule_lookup`、`service_guide_lookup`、
  `contact_directory_lookup` 的 positive routing cases
- fail-close、clarification 与 no-action guardrail cases
- final answer text 的产品可用性验证
- source trace / source refs 的 safe rendering 验证
- release gate profile / command，把 focused runtime tests、tool release gates 与 public/chat
  E2E 聚合成可重复 opening gate
- opening verdict artifact / docs，明确 product path 是否开放以及回滚条件

## Non-goals

- 不重开 authenticated notice collection、OCR/table parser、attachment collection 或 source-truth
  inventory
- 不重写 PostgreSQL structured projection 架构
- 不让 runtime query path 回扫 raw notice、portal HTML、handbook PDF、对象存储前缀或 generic
  retrieval chunks
- 不把 `campus-services-agent` 扩成通用 RAG / notice search owner
- 不实现预约、提交、代办、支付、工单创建、打电话、发邮件或任何状态变更
- 不把单次 local smoke 结果冒充为 staging / production opening verdict

## Tool Acceptance Matrix

### `service_status_lookup`

必须验证：

- 当前状态、开放 / 关闭、临时调整、乘车点变更能进入 `service_status_lookup`
- final answer 展示用户可执行事实，例如地点变更或当前运营说明
- source trace 能回到 structured source refs，不暴露 release id / projection internals
- currentness 不可证、source conflict 或缺关键字段时 fail-close

### `transport_schedule_lookup`

必须验证：

- 班车 / 接驳车时刻、方向、首班、末班、下一班、运营窗口能进入
  `transport_schedule_lookup`
- 长期线路、临时线路和 operational notices 在回答中表达清楚
- how-to / 预约说明不误入 schedule tool，应进入 `service_guide_lookup`
- projection window 外、route/direction 不明确时 clarification 或 fail-close

### `service_guide_lookup`

必须验证：

- 怎么办、材料、入口、办公时间、预约说明类问题进入 `service_guide_lookup`
- final answer 是只读指南，不生成提交、预约、支付或工单 handoff
- source refs、适用范围与 unavailable / clarification 文案可被 public/chat 呈现
- 纯联系方式问题不长期压在 service guide；应路由到 `contact_directory_lookup`

### `contact_directory_lookup`

必须验证：

- 部门电话、邮箱、办公地点、联系人、办公时间类稳定联系方式进入
  `contact_directory_lookup`
- ambiguous contact alias 返回 clarification，不默认猜测
- conflict / non-ready / restricted contact source fail-close
- “帮我打电话 / 发邮件 / 联系老师”等 action 请求不生成执行动作

## Required Prompt Denominator

首批 public/chat E2E prompts：

- “丰台校区通勤班车在哪里上车”
- “通勤班车丰台校区乘车点现在在哪里”
- “2月24日丰台回海淀最早的班车是几点”
- “地铁接驳车怎么预约”
- “校园卡丢了怎么办”
- “研究生院办公室电话是多少”
- “招生办联系方式”
- “帮我给招生办发邮件”

## Success Criteria

1. `public-chat-campus-services-e2e-acceptance` 在 `.planning/WORKSTREAMS.md` 中作为 active
   workstream 存在，并有完整 `README / REQUIREMENTS / ROADMAP / STATE`。
2. public/chat E2E harness 能在本地稳定启动或通过 Worker test harness 重放完整请求路径。
3. 四个 structured tools 都有至少一个 positive public/chat E2E case。
4. 四个 structured tools 都有至少一个 fail-close、clarification 或 no-action public/chat E2E case。
5. E2E 断言覆盖 selected target、selected tool / payload kind、answer text、source trace 与
   terminal guardrail。
6. release gate profile 能一键聚合 focused runtime tests、tool release gates 与 public/chat E2E。
7. opening verdict 明确列出可开放 tool、继续 closed tool、blocker、owner、验证命令与回滚条件。
8. 文档必须明确：通过 gate 只是 opening 条件，不反向改变 source-truth / projection / runtime owner。

## Canonical Entry

- `.planning/workstreams/public-chat-campus-services-e2e-acceptance/README.md`
