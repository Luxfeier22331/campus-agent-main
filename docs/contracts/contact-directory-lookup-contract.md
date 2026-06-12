---
doc_type: contract
status: active
created: 2026-04-27
updated: 2026-04-28
---
# Contact Directory Lookup Contract

## 文档边界

本文冻结 `contact_directory_lookup` 的 forward stable contract direction。

它覆盖：

- 后续 `packages/contracts` 内 `ContactDirectoryLookupPayload / Result` 的稳定语义
- `execution-control -> typed capability activity / internal query service`
  的 active execution seam
- `campus_services -> typed tool adapter -> internal query service`
  的 request/result seam
- 部门、科室、服务点、公开职务联系人、电话、邮箱、办公地点、办公时间与 source refs
  的 typed 结果边界

它不覆盖：

- 电话拨打、邮件发送、预约、提交、代办、支付、工单创建或任何状态变更
- browser-facing card payload 或 panel 像素设计
- contact directory source-truth projection builder 的实现细节
- `service_guide_lookup` 的办理指南 contract
- 临时活动联系人、招聘联系人或 notice-level 联系方式发现

## 当前 Rollout 状态

- `contact_directory_lookup` 已通过 `campus-services-product-path` opening gate，
  tool-level verdict 为 `open`（Phase 6，2026-04-27）。
- `campus_services/contact_directory` projection data-plane 与 PostgreSQL read model
  已纳入 opening denominator。
- `ContactDirectoryLookupPayload / Result`、Go structured query runtime、
  ToolSpec / CapabilitySpec seam、planner/policy routing、deterministic release gate
  与 public/chat E2E 已形成统一 opening verdict 证据。历史 Python thin adapter
  只能作为 offline / eval reference，不作为 active serving handoff。
- local gate 判定命令：
  `uv run --all-packages python -m scripts.eval_gate accept --profile
  campus-services-product-path --json`
- rollout flag 仍由 Go runtime 持有：
  `EXECUTION_CONTROL_OPEN_CAPABILITIES=campus_services`；未设置时产品路径仍应 fail-close。
- 2026-04-28 readiness closeout 已补齐：field-aware matching 覆盖
  `contact_points` / `office_hours`，agent 与 app-api answer shaping 组合
  phone / email / location / office hours，`帮我打电话` / `帮我发邮件` 等执行动作
  进入 transaction guardrail，release gate 纳入 app-api structured answer lane。

## Core Conclusion

`contact_directory_lookup` 是稳定机构联系方式 lookup tool，不是通用网页搜索、notice
联系人发现或可执行通讯 tool。

固定结论：

- “招生办电话是多少”“研究生院招生办公室邮箱”“国际合作处在哪里”属于
  `contact_directory_lookup`
- “校园卡丢了怎么办”“地铁接驳车怎么预约”不属于 `contact_directory_lookup`，应进入
  `service_guide_lookup`
- “今天卡务中心开不开”“班车乘车点现在改到哪里”不属于 `contact_directory_lookup`，应进入
  `service_status_lookup`
- “帮我打电话”“帮我发邮件”“替我预约”不属于 `contact_directory_lookup`，必须由 Execution Agent Layer
  保持 terminal guardrail / fail-close
- tool 只返回 source-linked structured facts，不返回 executable communication payload
- tool 不生成最终自然语言回答；最终回答组织属于 `campus_services`
- tool 不回扫 raw handbook table、official web page、notice HTML、browser 页面或 generic
  retrieval chunk

## Owner Split

- Execution Agent Layer
  - 拥有 capability admission、transactional guardrail、terminal semantics 与 high-level
    routing clarification
- `campus_services`
  - 拥有 campus-services family 内的 tool selection、contact-specific clarification、
    answer shaping 与 fail-close wording
- `contact_directory_lookup` thin tool adapter
  - 只负责 typed payload/result glue、allowed tool validation 与 query service 调用
- internal query service
  - 只负责 deterministic projection lookup、alias resolution、currentness validation、
    policy filtering 与 typed result shaping
- contact directory projection
  - 拥有 normalized contact facts、source refs、effective window、conflict state 与
    publication policy

## Request Contract

```text
ContactDirectoryLookupPayload
- query_text: str
- contact_focus:
  - phone
  - email
  - location
  - office_hours
  - contact_person
  - all_contacts
- entity_selector: ContactDirectoryEntitySelector | null
- temporal_query: TemporalQuery
- campus_scope: str
- audience:
  - student
  - faculty
  - visitor
  - unknown
- result_limit: int | null
```

固定语义：

- `query_text` 保留用户原问句或 agent 已归一化的联系人短语，不得为空
- `contact_focus` 表达用户要电话、邮箱、地点、办公时间、联系人，或完整联系方式
- `entity_selector` 表达已经解析出的部门 / 科室 / 服务 / 职务联系人约束；可以为空，
  但为空且候选不唯一时必须 clarification
- `temporal_query` 第一版只支持 `current` / `latest`；`as_of` 与 history query 保持 closed
- `campus_scope` 只表达已知校区约束，不能替代 entity selector
- `audience` 只用于筛选面向学生、教职工、访客或未知人群的联系入口
- `result_limit` 只限制候选联系人数量，不允许裁掉 source refs

### `ContactDirectoryEntitySelector`

```text
ContactDirectoryEntitySelector
- contact_id: str
- department_query: str
- office_query: str
- service_query: str
- person_query: str
- role_query: str
- purpose_query: str
- contact_group_query: str
- location_query: str
```

固定语义：

- `contact_id` 是上游已知 canonical identity 时的强约束
- `department_query` / `office_query` 用于“研究生院招生办公室”“国际交流科”等组织实体
- `service_query` 用于“校园卡”“本科招生”“研究生招生”等服务入口关联
- `person_query` 只允许匹配已公开且被 projection 标记为 official-role contact 的人员；
  不得作为个人手机号搜索入口
- `role_query` 用于“处长”“招生咨询”“综合办公室”等职务 / 功能入口
- `purpose_query` 用于“投诉”“招生咨询”“报修咨询”等 contact purpose
- `location_query` 只用于缩小办公地点，不做路径规划

## Result Contract

```text
ContactDirectoryLookupResult
- query_text: str
- contact_focus: same as request
- outcome:
  - resolved_current
  - clarification_required
  - not_found
  - temporarily_unverifiable
- resolved_contact: ContactDirectoryContactRef | null
- contact_points[]: ContactDirectoryContactPoint
- location_refs[]: ContactDirectoryLocationRef
- office_hours[]: ContactDirectoryOfficeHours
- candidate_contacts[]: ContactDirectoryCandidate
- source_refs[]: str
- queried_time_anchor: RFC3339 datetime
- effective_from: RFC3339 datetime
- effective_until: RFC3339 datetime
- clarification_reason:
  - contact_entity_ambiguous
  - contact_focus_required
  - department_required
  - campus_scope_required
  - audience_required
  - purpose_required
- fail_close_reason:
  - current_state_unverifiable
  - source_truth_unavailable
  - source_family_unavailable
  - source_conflict
  - privacy_policy_restricted
  - stable_contact_unavailable
```

### `ContactDirectoryContactRef`

```text
ContactDirectoryContactRef
- contact_id: str
- display_name: str
- aliases[]: str
- entity_type:
  - department
  - office
  - service_point
  - role_contact
  - public_person_role
  - hotline
- department: str
- contact_group: str
- campus_scope: str
- audience[]:
  - student
  - faculty
  - visitor
  - unknown
```

### `ContactDirectoryContactPoint`

```text
ContactDirectoryContactPoint
- channel_type:
  - phone
  - email
  - fax
  - website
- label: str
- value: str
- normalized_value: str
- contact_type: str
- area_served: str
- available_language: str
- hours_ref: str
- source_refs[]: str
```

### `ContactDirectoryLocationRef`

```text
ContactDirectoryLocationRef
- label: str
- location_ref: str
- address_text: str
- source_refs[]: str
```

### `ContactDirectoryOfficeHours`

```text
ContactDirectoryOfficeHours
- hours_id: str
- label: str
- day_pattern: str
- time_range: str
- effective_note: str
- source_refs[]: str
```

### `ContactDirectoryCandidate`

```text
ContactDirectoryCandidate
- contact: ContactDirectoryContactRef
- clarification_hint: str
```

固定语义：

- `resolved_current` 时必须给出 `resolved_contact`、至少一个 `contact_points` /
  `location_refs` / `office_hours`，以及覆盖所有返回事实的 `source_refs`
- `clarification_required` 时必须给出 `candidate_contacts` 或明确的
  `clarification_reason`
- `temporarily_unverifiable` 时必须给出 `fail_close_reason`
- `privacy_policy_restricted` 表示 projection 命中但不允许对当前 requester / surface
  暴露；不得把被策略隐藏的个人联系方式包装成 `not_found`
- `stable_contact_unavailable` 表示 source 只有临时活动 / notice-level 联系方式，
  不能提升为稳定 contact directory truth

## Query-Time Rules

- 只读 `campus_services/contact_directory` PostgreSQL current release 与 typed
  read model
- 不直接读对象存储、不持有对象存储凭据、不使用 mounted file fallback
- 不在 query time 扫描 raw PDF、handbook table、official web HTML、notice HTML 或 generic
  retrieval chunk
- `current/latest/effective` 由 code-owned temporal policy 解释；第一版不开放 historical
  contact lookup
- 只有 `extraction_status=ready`、source refs 完整、无 unresolved conflict 的 record 才能返回
  `resolved_current`
- alias 不唯一时必须 `clarification_required`，不得默认选择搜索分数最高的联系人
- 联系人来自 notice、招聘、实习、活动或临时公告时，默认不进入 stable contact directory；
  这类问题应由 notice / service guide / service status 的 owner surface 处理
- 个人姓名查询只允许命中 official-role contact；不得提供未被 source truth admission 的个人手机号
  或私人邮箱
- 如果用户要求系统拨打电话、发送邮件或代办联系，Execution Agent Layer 不得生成执行型 handoff；
  `contact_directory_lookup` 只返回只读联系方式

## Routing Rules

- 纯联系方式问题进入 `contact_directory_lookup`
  - “本科招生办电话”
  - “研究生招生办公室邮箱”
  - “国际合作处在哪里”
- 办理说明、材料、入口说明进入 `service_guide_lookup`
  - “校园卡丢了怎么办”
  - “地铁接驳车怎么预约”
- 当前开放状态、临时调整、地点临时变更进入 `service_status_lookup`
  - “卡务中心今天开不开”
  - “班车乘车点现在在哪里”
- 班次、首末班、下一班进入 `transport_schedule_lookup`
- notice 正文、公告发现或临时活动联系人进入 `notice`
- 地点路线、怎么走、地图展示进入 `navigation`

## Eval / Opening Gate

打开 `contact_directory_lookup` 前至少需要：

- 已完成：
  - contract model tests：payload/result 枚举、source refs、clarification 与 fail-close
    validation
  - structured query tests：resolved/ambiguity/fail-close/read-model 模式与 HTTP handler
    wiring
  - campus_services adapter tests：phone/email/location/hours
    answer shaping 与
    candidate clarification
  - Execution Agent Layer planner/router tests：联系方式路由到 `contact_directory_lookup`，并保持
    其他 capability 分流
  - deterministic release gate：
    `uv run --all-packages python -m scripts.eval_gate accept --profile contact-directory-lookup`
  - `public/chat` E2E：从真实入口验证最终 answer text、source trace 与 no-action
    boundary
  - opening verdict：和 `service_status_lookup` / `transport_schedule_lookup` /
    `service_guide_lookup` 一起完成 product-path gate 决策

Phase 6 snapshot（2026-04-27）：

- `public/chat` E2E 与 opening verdict 已完成，`contact_directory_lookup`
  当前 tool-level verdict 为 `open`。
- 长尾 alias 覆盖、历史语义与 denominator 扩展继续回写到
  `campus-services-runtime-tool-gap-closeout`。

首批 golden prompts：

- “本科招生办电话是多少”
- “研究生院招生办公室邮箱”
- “研究生招生各学院联系电话”
- “国际合作处在哪里”
- “国际交流科邮箱是什么”
- “校园卡管理中心电话”
- “招生办联系方式”
- “帮我给招生办发邮件”
- “某位老师的手机号是多少”

预期：

- 前五类如果 projection ready，应 `resolved_current`
- “招生办联系方式”若本科 / 研究生 / 国际招生不唯一，应 `clarification_required`
- “帮我给招生办发邮件”不应生成执行动作
- 私人手机号查询应 `not_found` 或 `temporarily_unverifiable/privacy_policy_restricted`

## Prompt Policy

第一版不为 `campus_services` 增加独立 LLM prompt。正确性 owner 是：

- Execution Agent Layer deterministic routing / payload construction
- strict typed payload/result contract
- projection-backed internal query service
- deterministic answer shaping
- eval gate

如果后续使用模型生成 tool arguments，应采用严格 schema 的 function calling；
如果后续让模型参与答案压缩或澄清措辞，必须先把 prompt 纳入 eval gate，并保留
deterministic structured result 作为不可改写的事实输入。
