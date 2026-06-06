---
doc_type: contract
status: active
created: 2026-04-25
updated: 2026-04-26
---
# Service Guide Lookup Contract

## 文档边界

本文冻结 `service_guide_lookup` 的 forward stable contract direction。

它覆盖：

- `packages/contracts` 内后续 `ServiceGuideLookupPayload / Result` 的稳定语义
- `apps/supervisor-agent-worker -> packages/campus-services-agent` 的 handoff seam
- `campus-services-agent -> thin tool adapter -> internal query service`
  的 request/result seam
- 办理指南、材料、入口说明、服务时间、联系方式、适用范围与 source refs 的 typed
  结果边界

它不覆盖：

- 表单提交、预约、代办、支付、工单创建或任何业务状态变更
- browser-facing card payload 或 panel 像素设计
- 具体 parser、collector、对象存储部署命名或 release job 实现
- `contact_directory_lookup` 的纯联系人目录查询 contract

## 当前 Rollout 状态

- `service_guide_lookup` 已通过 `campus-services-product-path` opening gate，
  tool-level verdict 为 `open`（Phase 6，2026-04-27）。
- 当前 repo 的 shared contract、Go internal query endpoint、Python thin adapter、
  source-truth projection builder 与 release gate 已纳入 opening denominator。
- local gate 判定命令：
  `uv run --all-packages python -m scripts.eval_gate accept --profile
  campus-services-product-path --json`
- rollout flag 仍由 Go runtime 持有：
  `EXECUTION_GATEWAY_OPEN_CAPABILITIES=campus_services`；未设置时产品路径仍应 fail-close。

## Core Conclusion

`service_guide_lookup` 是只读 service guide facts lookup tool，不是事务执行 tool。

固定结论：

- “校园卡怎么申请”“宿舍报修怎么办理”“会议室预约流程是什么”属于
  `service_guide_lookup`
- “帮我提交申请”“替我预约会议室”“代我办理校园卡”不属于
  `service_guide_lookup`
- tool 只返回 source-linked structured facts，不返回 executable transaction payload
- tool 不生成最终自然语言回答；最终回答组织属于 `campus-services-agent`
- tool 不回扫 raw source bundle、notice HTML、browser 页面或 generic retrieval chunk
- service guide runtime backing 必须读取 normalized projection，而不是 query-time source
  scan

## Owner Split

- supervisor
  - 拥有 capability admission、high-risk / transactional guardrail、terminal semantics
    与 routing clarification
- `campus-services-agent`
  - 拥有 campus-services family 内的 tool selection、service-specific clarification、
    answer shaping 与 fail-close wording
- `service_guide_lookup` thin tool adapter
  - 只负责 typed payload/result glue、allowed tool validation 与 query service 调用
- internal query service
  - 只负责 deterministic projection lookup、alias resolution、temporal validation 与
    typed result shaping
- service guide projection
  - 拥有 normalized guide facts、source refs、effective window、non-ready blocking 与
    conflict state；不再向 runtime 暴露人工审核状态

## Request Contract

```text
ServiceGuideLookupPayload
- service_query: str
- guide_focus:
  - overview
  - procedure
  - required_materials
  - entry
  - office_hours
  - contact
  - eligibility
  - full_guide
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

- `service_query` 保留用户原问句或 agent 已归一化的服务短语，不得为空
- `guide_focus` 表达用户关注的 guide section，不承担事务动作
- `full_guide` 只表示“返回完整说明字段”，不表示执行完整办理流程
- `temporal_query` 复用 repo-owned `TemporalQuery`
- `campus_scope` 只表达已知校区约束，不能替代 `service_query`
- `audience` 只用于筛选适用范围；未知时必须填 `unknown`
- `result_limit` 只限制候选服务或 section 数量，不允许裁掉 source refs

## Result Contract

```text
ServiceGuideLookupResult
- service_query: str
- guide_focus: same as request
- outcome:
  - resolved_current
  - clarification_required
  - not_found
  - temporarily_unverifiable
- resolved_service: ServiceGuideServiceRef | null
- guide_sections[]: ServiceGuideSection
- procedure_groups[]: ServiceGuideProcedureGroup
- required_materials[]: ServiceGuideMaterial
- entry_refs[]: ServiceGuideEntryRef
- office_hours[]: ServiceGuideOfficeHours
- contact_refs[]: ServiceGuideContactRef
- eligibility_notes[]: str
- source_refs[]: str
- selected_section_ids[]: str
- omitted_section_ids[]: str
- omitted_section_reasons: map[str, str]
- candidate_services[]: ServiceGuideCandidate
- queried_time_anchor: RFC3339 datetime
- effective_from: RFC3339 datetime
- effective_until: RFC3339 datetime
- clarification_reason:
  - service_ambiguous
  - campus_scope_required
  - audience_required
  - guide_focus_required
- fail_close_reason:
  - current_state_unverifiable
  - source_truth_unavailable
  - temporal_scope_ambiguous
  - source_family_unavailable
  - source_conflict
```

### `ServiceGuideServiceRef`

```text
ServiceGuideServiceRef
- service_id: str
- display_name: str
- aliases[]: str
- category: str
- campus_scope: str
- audience[]: str
```

### `ServiceGuideSection`

```text
ServiceGuideSection
- section_id: str
- section_type:
  - overview
  - procedure
  - required_materials
  - entry
  - office_hours
  - contact
  - eligibility
- title: str
- content: str
- source_refs[]: str
```

### `ServiceGuideProcedureGroup`

```text
ServiceGuideProcedureGroup
- group_id: str
- title: str
- focus_tags[]: str
- steps[]: ServiceGuideProcedureStep
- source_refs[]: str
```

### `ServiceGuideProcedureStep`

```text
ServiceGuideProcedureStep
- step_id: str
- content: str
- source_refs[]: str
```

### `ServiceGuideMaterial`

```text
ServiceGuideMaterial
- name: str
- required: bool
- note: str
- source_refs[]: str
```

### `ServiceGuideEntryRef`

```text
ServiceGuideEntryRef
- label: str
- entry_type:
  - online_url
  - offline_location
  - phone
  - email
  - instructions_only
- url: str
- location_ref: str
- source_refs[]: str
```

### `ServiceGuideOfficeHours`

```text
ServiceGuideOfficeHours
- label: str
- day_pattern: str
- time_range: str
- effective_note: str
- source_refs[]: str
```

### `ServiceGuideContactRef`

```text
ServiceGuideContactRef
- label: str
- department: str
- phone: str
- email: str
- location_ref: str
- source_refs[]: str
```

### `ServiceGuideCandidate`

```text
ServiceGuideCandidate
- service: ServiceGuideServiceRef
- clarification_hint: str
```

固定语义：

- `resolved_current` 时必须给出 `resolved_service` 与至少一个 source-linked
  guide fact
- `procedure_groups` 是 canonical procedure truth；`guide_sections` 仍保留为兼容字段，
  但 focused procedure answer 优先消费 `procedure_groups`
- `clarification_required` 时必须给出 `candidate_services` 或明确的
  `clarification_reason`
- `temporarily_unverifiable` 时必须给出 `fail_close_reason`
- `source_refs` 必须覆盖最终返回的每个事实来源
- `selected_section_ids` / `omitted_section_ids` / `omitted_section_reasons`
  用于表达 focused runtime answer 的选择结果，不得要求前端自行重算
- `entry_refs` 只能表达“入口说明”，不能表达可执行 transaction payload
- `contact_refs` 可由 guide projection 内嵌，也可引用 contact projection 派生事实；纯联系人查询仍应走
  `contact_directory_lookup`

## Query-Time Rules

- 只读 `campus_services/service_guide` normalized projection
- 不读 query-disabled retrieval alias，不把 generic RAG 当作 runtime query seam
- 不允许 query-time raw HTML / notice / browser scan
- 不允许 query-time 生成或补全缺失材料、流程、入口或联系方式
- service alias 命中多个 current record 时必须 `clarification_required`
- matched record 缺 source refs、effective window、关键 guide section 或存在 unresolved
  conflict 时必须 `temporarily_unverifiable`
- matched record 已过期时不得继续回答 `resolved_current`
- 用户要求系统代办、提交、预约、支付或创建工单时，不生成
  `service_guide_lookup` handoff；由 supervisor terminal guardrail 处理

## Guide Focus Taxonomy

- `overview`
  - 问“这个服务是什么”“能办什么”
- `procedure`
  - 问“怎么办理”“流程是什么”“怎么申请”
- `required_materials`
  - 问“需要什么材料”“要准备什么”
- `entry`
  - 问“在哪里办”“入口在哪”“线上入口”
- `office_hours`
  - 问“办理时间”“窗口什么时候开”
- `contact`
  - 问“找谁”“电话多少”“负责部门”
- `eligibility`
  - 问“谁能办”“适用条件”“前置条件”
- `full_guide`
  - 用户明确要求完整办理说明，或 agent 判断单一 section 不足以回答

## Projection Backing

`service_guide_lookup` 的 runtime backing 固定读取
`campus_services_service_guide_projection.v1`。

第一版 data-plane 决策：

- source truth 可来自 handbook-derived service navigation pages、official-web
  办事说明页、service portal / 一网通办事项页与 future service entry page
- `campus_services/service_catalog` 是 service guide projection 的主要 upstream
  logical owner
- `campus_services/contact_directory` 可作为 contact refs 的 upstream，但不替代
  `contact_directory_lookup`
- builder 离线抽取 service records、section facts、materials、entry refs、office hours、
  contacts 与 source refs
- builder 必须输出 validation summary；带人工审核标记的旧 source truth 不能进入新 release
- Go `apps/execution-gateway` 通过 PostgreSQL `structured_projection_current` current
  pointer 与 typed `service_guide_read_model` 读取当前 release，不直接读取对象存储，也不再支持
  mounted current projection file runtime path

projection schema 细节见
`docs/data/campus-services-service-guide-source-truth-schema.md`。

## Observability Contract

structured runtime summary 至少需要暴露低基数字段：

```text
selected_target = campus-services-agent
selected_tool = service_guide_lookup
business_outcome = resolved_current | clarification_required | not_found | temporarily_unverifiable
service_guide_focus = guide_focus
fail_close_reason = fail_close_reason
clarification_reason = clarification_reason
matched_service_category = resolved_service.category
```

不得在 metrics label、OTel attribute 或 execution audit 低基数字段中写入 raw user text、
完整材料清单或完整入口 URL。source refs 可写入 request projection / audit body，但不应进入
metrics label。

## Eval Requirements

第一版 release gate 至少覆盖：

- 信息型 guide query
  - “校园卡怎么申请”
  - “宿舍报修怎么办理”
  - “会议室预约流程是什么”
  - “补办学生证需要什么材料”
- focus-specific query
  - 材料、入口、办理时间、联系方式、适用人群
- ambiguity query
  - 同名或近义服务导致多个 candidate 时必须 clarification
- fail-close query
  - projection 缺 source refs、缺关键 section、过期或冲突时不得编造
- transaction guardrail query
  - “帮我提交申请”“替我预约会议室”“代我办理校园卡”不得进入
    `service_guide_lookup`

## Opening Gate

`service_guide_lookup` 的 product serving surface 只有在以下条件同时满足时才能打开：

- shared contract 已实现并有 contract tests
- Go internal query endpoint 已实现并有 deterministic fixture tests
- Python thin adapter 已实现并验证 allowed tools / payload kind
- service guide projection builder 与 validation summary 已落地，且新 release 不接受人工审核状态
- app-api typed observability summary 能展示 selected tool、business outcome 与 fail-close
  reason
- intent eval / release gate 覆盖 guide query、ambiguity、fail-close 与 transaction guardrail
- docs 明确当前 serving surface 与 rollback 条件

Phase 6 snapshot（2026-04-27）：

- 上述条件已由 `campus-services-product-path` opening gate 聚合验证通过。
- tool-level verdict 已进入 `open`，但环境是否对真实用户开放仍受
  `EXECUTION_GATEWAY_OPEN_CAPABILITIES` 控制。
