---
doc_type: plan
status: active
created: 2026-04-21
updated: 2026-04-21
---

# Notice Semantic Fan-out And Consumption Modeling

## Goal

把“单条通知如何拆成可消费的语义单元”从临时讨论推进到 repo-tracked planning truth：
冻结 `source_notice / notice_attachment / derived consumption unit` 的关系、role taxonomy、
attachment authority、completeness contract，以及后续交给 `notice-agent`、future
`rag-agent`、`campus-services-agent` 的 handoff 规则。

## This Document Covers

- `source_notice` 作为 canonical upstream truth 的边界
- `source_notice + attachment -> derived consumption units` 的 fan-out 形态
- notice body、attachment body、wrapper text 的 authority / precedence 规则
- role taxonomy，例如：
  - `notice_window`
  - `annual_cycle_rule`
  - `time_bound_operational_rule`
  - `roster_publication`
  - `lecture_activity`
  - `service_status_override`
  - `attachment_rule_body`
  - `attachment_form_template`
- `primary_role`、`default_agent`、`target_surface`、`temporal_policy`、`completeness_status`
  等核心字段
- public notice 与 restricted internal notice 是否共用同一 semantic fan-out contract
- 后续 routing 给 `notice-agent`、future `rag-agent`、`campus-services-agent` 的条件

## This Document Does Not Cover

- `campus_notice_discover/get`、`service_status_lookup` 等 runtime tool 的直接实现
- `official_web/fresh_news` / `news_archive` opening
- `regulations/scoped_rules` 或其他 surface 的 query-serving reopen
- auth-dependent notice capture、`file_release` owner recovery
- replay、OCR、chunking、embedding、release promotion 细节

## Bounded Problem Statement

当前 notice 设计已经能讨论：

- 哪些问题应进 `notice-agent`
- 哪些问题不应直接进 generic RAG
- 哪些校园服务状态问题更像 `campus-services-agent`

但仍缺少正式建模来回答：

- 一条通知能否同时服务多个消费角色
- 正文和附件谁是权威 body
- 附件没抓到时哪些答案还能给、哪些必须 fail-close
- 年度规则、临时运营规则、名单公示、讲座预告是否应共用同一 notice 对象
- 未来 `annual_cycle_rule` / `time_bound_operational_rule` 的 product entry 应如何衔接 runtime lane

## Implementation Direction

1. 保持 `source_notice` 作为 canonical upstream，不直接改写或覆盖原 notice truth。
2. 在 data plane 增加 semantic fan-out / processing contract，而不是增加新的顶层用户可见 agent。
3. 单条 notice 允许 fan-out 到多个 derived consumption unit，但每个 unit 只能有一个 `primary_role`。
4. execution/runtime path 只消费 typed derived projection，而不是 query-time 临时解析原始 notice HTML。
5. notice body 与 attachment body 的 authority 必须显式表达；`attachment missing` 不能被伪装成“规则完整”。
6. `notice-agent` 继续承接显式 notice task；future `rag-agent` / `campus-services-agent` 只消费满足 contract 的派生单元。
7. 在任何 query-serving reopen 之前，先把 taxonomy、metadata、authority 与 handoff freeze 成 repo truth。

## First Modeling Slice

- exemplar notice:
  - `关于启动2026届推荐优秀应届本科毕业生免试攻读研究生工作的通知`
- initial modeling questions:
  - `notice_window` 与 `annual_cycle_rule` 如何在同一 source notice 中共存
  - notice body 与附件《实施办法》的 authority 如何表达
  - `attachments_declared != attachments_captured` 时如何建模 completeness
  - 当前 runtime 是否只能走 `notice-agent`，future rule lane 需要哪些 metadata / gates

## Planned Phases

- `Phase 1`
  - `Notice Source And Role Taxonomy Freeze`
- `Phase 2`
  - `Derived Consumption Unit Schema Freeze`
- `Phase 3`
  - `Attachment Authority And Completeness Contract Freeze`
- `Phase 4`
  - `Agent Routing And Target Surface Handoff Freeze`
- `Phase 5`
  - `Verification Slice And Adoption Routing`

## Handoff Note

这条 workstream 当前只完成 planning truth 创建，不代表 notice semantic processor 已经实现。
后续会话恢复时，应先从 `Phase 1` 开始收口 taxonomy 与 authority model，
而不是直接实现新的 runtime tool 或 reopen query surface。
