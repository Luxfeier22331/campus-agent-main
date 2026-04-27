---
doc_type: roadmap
status: active
created: 2026-04-27
updated: 2026-04-27
---

# Roadmap: Public Chat Campus Services E2E Acceptance

## Overview

这条 workstream 的目标不是继续补内部 unit test，而是把 `campus-services-agent`
structured tools 放到 public/chat 产品路径里验收，并产出 opening verdict。

执行顺序固定为：

`planning hygiene -> E2E harness -> routing matrix -> answer/source trace -> fail-close -> release gate -> opening verdict`

## Phases

- [x] **Phase 0: Planning Truth And Worktree Hygiene**
  - 确认当前 worktree 中 contact directory、campus services runtime、eval、docs、ingestion
    等改动的逻辑边界
  - 排除与本 workstream 无关的改动，不把产品 E2E 补丁混进 source-truth / ingestion 清理
  - 固化本 workstream 的 `README / REQUIREMENTS / ROADMAP / STATE`
  - 验证当前 focused gates 仍可运行，作为 E2E 前置基线

- [x] **Phase 1: Public Chat E2E Harness And Preflight**
  - 明确本地 E2E 运行方式：Worker test harness、local service stack，或 staging smoke
  - 补齐 public-chat-web / app-api / supervisor-api 请求路径的可测试入口
  - 固定 capability flags、structured query shared secret、test session / anonymous mode
  - 增加 structured projection readiness preflight，失败时给出可诊断 blocker

- [x] **Phase 2: Positive Routing And Handoff Matrix**
  - 覆盖 `service_status_lookup` positive cases：当前状态、乘车点变更、开放 / 关闭
  - 覆盖 `transport_schedule_lookup` positive cases：班次、方向、首班 / 下一班、运营窗口
  - 覆盖 `service_guide_lookup` positive cases：怎么办、材料、入口、预约说明
  - 覆盖 `contact_directory_lookup` positive cases：电话、邮箱、地点、联系人
  - 断言 selected target、allowed tool / payload kind、agent handoff 与 structured result shape

- [ ] **Phase 3: Answer Rendering And Source Trace Acceptance**
  - 验证 final answer text 只使用 structured result facts
  - 验证 `status_note`、`operational_notices`、guide sections、contact points 的产品化表达
  - 验证 source refs / notice refs / contact source refs 的 safe rendering
  - 防止回答暴露 release id、projection internals、raw table parser state 或 debug-only fields

- [ ] **Phase 4: Fail-close, Clarification, And No-action Guardrails**
  - 覆盖 route/direction/contact ambiguity -> clarification
  - 覆盖 currentness 不可证、source conflict、projection 缺关键字段 -> fail-close
  - 覆盖 how-to 与 schedule/status/contact 的互斥路由
  - 覆盖“帮我预约 / 代我提交 / 帮我打电话 / 发邮件”不生成执行动作
  - 验证 fail-close 文案不退回 generic retrieval 编造答案

- [ ] **Phase 5: Campus Services Product-path Opening Gate**
  - 新增或扩展 shared eval gate profile：`campus-services-product-path`
  - 聚合 focused runtime tests、`service-guide-lookup` gate、`contact-directory-lookup` gate、
    Go structured runtime tests、Python agent adapter tests 与 public/chat E2E
  - 产出机器可读 gate artifact：通过项、失败项、tool-level verdict、运行命令、版本摘要
  - 明确 local gate 与 staging gate 的差异，不把 local pass 当 staging opening

- [ ] **Phase 6: Opening Verdict, Rollout Flags, And Handoff**
  - 更新 campus services architecture / runbook，记录 opening verdict
  - 按 tool 粒度给出 `open / keep closed / blocked` 结论
  - 明确 rollout flag、回滚条件、source trace 观察点与后续 owner
  - 将仍未开放的项回写到 `campus-services-runtime-tool-gap-closeout` 或对应 data-plane
    workstream，不在 public/chat workstream 中继续堆 source-truth 修复

## Exit Criteria

本 workstream 完成时必须能回答：

- public/chat 产品路径现在实际能使用哪些 campus services tools？
- 每个可用 tool 的 positive / negative denominator 是什么？
- source trace 是否可向用户安全展示？
- 哪些 tool 仍 closed，具体 blocker 是 routing、projection、answer rendering、E2E harness
  还是 data-plane？
- 下一次 release 前应该运行哪条命令得到同样 verdict？
