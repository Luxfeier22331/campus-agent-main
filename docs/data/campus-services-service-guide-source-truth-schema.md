---
doc_type: data
status: active
created: 2026-04-25
updated: 2026-04-26
---
# Campus Services Service Guide Source-Truth Schema

## 文档边界

本文冻结 `campus_services/service_guide` 第一版 projection 的 source-truth 消费与
artifact schema。

它回答：

- `service_guide_lookup` 第一版消费哪些上游 source truth
- service guide facts 如何被抽取为 service、section、material、entry、office hour 与
  contact
- `campus_services_service_guide_projection.v1` 的生成、校验与发布边界
- Go structured query runtime 如何消费 current projection

它不覆盖：

- `service_guide_lookup` 的 request/result contract
- 表单提交、预约、代办、支付、工单创建或任何业务状态变更
- browser-facing card payload
- 产品主路径 opening gate

## Core Conclusion

`campus_services/service_guide` 是只读办理指南 projection owner，不是 transaction
workflow owner。

固定规则：

- source truth 只作为 provenance 上游；runtime 只读 normalized projection
- service guide facts 必须 source-linked
- materials、procedure、entry、office hours、contact 与 eligibility 缺关键来源时必须
  manual review 或 fail-close
- 入口 URL 只能作为用户可见说明，不得生成自动提交、预约或 work-order payload
- PostgreSQL release catalog、`structured_projection_current` 与 typed read model
  保存 current serving truth；Docker runtime 只读 PG current release/read model，
  不回扫对象存储 raw source

## Input Source Truth

第一版允许的 upstream family：

- handbook-derived service navigation pages
  - 通过 source projection selector 定位 `source_title + source_handbook_section +
    source_page_start/source_page_end`
  - 流程图类 source truth 使用 `handbook_curated_service_flow_graph.v1`
  - 非流程图、但已由文档站整理并人工确认字段语义的办理指南使用
    `handbook_curated_service_guide.v1`
- `campus_services/service_catalog`
  - service entries、topic landing pages、service portal pages、办事入口说明页
- official-web service reference pages
  - official web 中稳定的办事说明、入口说明、部门服务说明
  - 已人工整理为结构化字段的官方网页办理指南使用
    `official_web_curated_service_guide.v1`
- future service entry page
  - 一网通办或服务门户事项详情页；只作为只读说明来源
- `campus_services/contact_directory`
  - 只作为 contact refs 的派生来源，不替代 pure contact directory query
- authenticated notice consumption projection 中已准入的交通预约说明
  - 输入必须是 `notice_consumption_projection` 的 ready
    `campus_services/special_service_candidate`
  - `role_metadata.special_service_candidate_kind` 固定为
    `transport_reservation_instruction`
  - 第一版只抽取只读预约入口、预约开放时间与使用约束，进入
    `service_guide_lookup`
  - 同一 notice 的班次运行事实仍由 `campus_services/transport_schedule`
    消费，不进入 service guide

不允许的 upstream：

- query-time browser page scrape
- raw HTML without normalized source-truth manifest
- unreviewed OCR fragments without source refs
- user-provided freeform instructions
- transaction backend API、预约系统 API、支付系统 API 或工单系统 API

当前 tracked curated service guide source truth：

- canonical source-truth manifest:
  `configs/ingestion/campus_services/service_guide/source-truth.v1.json`
  - 由 `regulations/student_rules` handbook raw ingestion / provider-response replay
    在成功后消费，发布
    `campus_services/releases/service_guide/current/service-guide-projection.json`
  - 独立 worker CLI 只作为 debug/recovery 路径，不作为唯一 canonical build path
- `configs/ingestion/regulations/student_rules/curated-flow-graphs/central-minzu-student-dormitory-management-workflow.v1.json`
  - 来源：`中央民族大学学生公寓管理工作流程`，学生手册第 252-255 页
  - 覆盖：入住、毕业离校、本科生不住宿、研究生不住宿、本科生退宿、研究生退宿流程
- `configs/ingestion/regulations/student_rules/curated-service-guides/central-minzu-student-public-medical.v1.json`
  - 来源：`中央民族大学学生公费医疗管理办法`，学生手册第 259-260 页
  - 覆盖：公费医疗资格与就医规则、公费医疗报销办理指南、公费医疗不予报销范围
  - 不覆盖：联系电话、办公时间；这类 focus 查询必须保持 fail-close / unavailable
- `configs/ingestion/regulations/student_rules/curated-service-guides/central-minzu-student-affairs-services.v1.json`
  - 来源：`中央民族大学学生申诉管理办法`，学生手册第 133-137 页；`中央民族大学本科(预科)学生证管理办法`，学生手册第 163-165 页
  - 覆盖：学生证补办办理指南、学生申诉办理指南
- `configs/ingestion/regulations/student_rules/curated-service-guides/central-minzu-student-financial-aid-services.v1.json`
  - 来源：`中央民族大学家庭经济困难学生临时困难补助管理办法`，学生手册第 217-219
    页；`中央民族大学本(预)科学生勤工助学管理办法`，学生手册第 220-225
    页；`中央民族大学助学贷款管理暂行办法`，学生手册第 240-246 页
  - 覆盖：临时困难补助申请指南、国家助学贷款申请指南、勤工助学岗位聘用指南
- `configs/ingestion/campus_services/service_guide/curated-service-guides/central-minzu-campus-card-official-web.v1.json`
  - 来源：信息化建设管理处学生校园卡服务页与迎新站一卡通页
  - 覆盖：校园卡挂失、补卡、两校区线下地点、咨询电话与补卡后余额领取说明

当前 source-truth manifest 的 release gate 固定期望 15 条 ready record：
宿舍流程 6 条、公费医疗 3 条、学生日常事务 2 条、资助事务 3 条、校园卡 1 条。

notice-derived service guide record 是 additive upstream family。发布 current
projection 时必须和上述 curated/source-truth records 合并，不得用单条 notice-derived
release 覆盖现有办理指南 current projection。

## Projection Bundle

生成 artifact 固定为 `campus_services_service_guide_projection.v1`。

顶层字段：

```text
schema_version
generated_at
source_families[]
service_guide_records[]
conflict_records[]
manual_review_sources[]
```

versioned artifact：

`campus_services/releases/service_guide/{release_id}/service-guide-projection.json`

current artifact：

`campus_services/releases/service_guide/current/service-guide-projection.json`

伴随 artifact：

- `validation-summary.json`
- `release-manifest.json`
- `manual-review-report.json`（legacy release layout compatibility；新 release 必须为空）

长期 serving truth 由 PostgreSQL 持有：ingestion worker 在 immutable object artifact
写入成功后，发布 release catalog、`structured_projection_current` current pointer 与
`service_guide_read_model` typed read model。Go `apps/execution-control` 通过 PG current
release 读取 `service_guide_lookup` 数据，不直接读对象存储、不持有对象存储凭据。

文件 projection path runtime 已下线；本地 fixture、smoke 与 bootstrap 也应通过
PostgreSQL release catalog / typed read model 验证，不再挂载 current projection file。

## Service Guide Record

```text
ServiceGuideRecord
- service_id: str
- display_name: str
- aliases[]: str
- category: str
- campus_scope: str
- audience[]:
  - student
  - faculty
  - visitor
  - unknown
- effective_from: RFC3339 datetime
- effective_until: RFC3339 datetime
- source_refs[]: str
- guide_sections[]: ServiceGuideSectionRecord
- procedure_groups[]: ServiceGuideProcedureGroupRecord
- materials[]: ServiceGuideMaterialRecord
- entry_refs[]: ServiceGuideEntryRecord
- office_hours[]: ServiceGuideOfficeHoursRecord
- contact_refs[]: ServiceGuideContactRecord
- eligibility_notes[]: str
- extraction_status:
  - ready
  - conflicted
  - incomplete
```

固定语义：

- `service_id` 是 projection 内 canonical identity，不使用页面 URL 作为长期 ID
- `display_name` 与 `aliases` 用于 deterministic alias match
- `category` 用于 observability 与 panel filter，不作为权限边界
- `effective_from/effective_until` 为空或非法时不得发布为 current-ready record
- `source_refs` 必须覆盖 record-level provenance
- `procedure_groups` 是 procedure 类事实的 canonical projection truth；
  `guide_sections` 中的 `procedure` section 仅保留兼容摘要，不再承担细粒度步骤分组语义
- `extraction_status != ready` 的 record 不得返回 `resolved_current`；新 release 不接受
  人工审核状态，无法机器确认的来源必须阻断发布或标记为 `incomplete`

## Guide Section Record

```text
ServiceGuideSectionRecord
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
- order: int
- source_refs[]: str
```

固定语义：

- `procedure` section 必须保留步骤顺序
- `entry` section 只能描述入口，不得包含 executable transaction payload
- `content` 必须来自 source truth 或人工审核后的 normalized text
- 缺 `source_refs` 的 section 必须进入 manual review

## Procedure Group Record

```text
ServiceGuideProcedureGroupRecord
- group_id: str
- title: str
- focus_tags[]: str
- order: int
- steps[]: ServiceGuideProcedureStepRecord
- source_refs[]: str
```

```text
ServiceGuideProcedureStepRecord
- step_id: str
- content: str
- order: int
- source_refs[]: str
```

固定语义：

- `procedure_groups` 只表达 source-backed grouped procedure truth，不在 query time 从
  `guide_sections.content` 反解析
- `focus_tags` 用于 deterministic focused answer selection，例如 `entry`、
  `direct_login`、`install`、`client`、`mobile`
- group 和 step 都必须保留 `source_refs`
- 同一 record 可同时保留 `guide_sections.procedure` 与 `procedure_groups`，但二者必须来自同一
  admitted source family，不得跨 source 拼接

## Material Record

```text
ServiceGuideMaterialRecord
- material_id: str
- name: str
- required: bool
- note: str
- source_refs[]: str
```

固定语义：

- `required=true` 必须有明确来源
- 无法确认必需性的材料只能进入 `note` 或 manual review，不得默认标必需

## Entry Record

```text
ServiceGuideEntryRecord
- entry_id: str
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

固定语义：

- `online_url` 是用户可见入口引用，不是自动提交 endpoint
- `location_ref` 可被 `navigation` 后续消费，但 `service_guide_lookup` 不做路线规划
- 电话和邮箱可内嵌在 guide record 中；纯联系人查找后续仍由
  `contact_directory_lookup` 承接

## Office Hours Record

```text
ServiceGuideOfficeHoursRecord
- hours_id: str
- label: str
- day_pattern: str
- time_range: str
- effective_note: str
- source_refs[]: str
```

固定语义：

- `day_pattern` 与 `time_range` 是展示和筛选事实，不替代
  `service_status_lookup` 的 current-effective status
- 临时关闭、临时调整或当前状态问题仍应进入 `service_status_lookup`

## Contact Record

```text
ServiceGuideContactRecord
- contact_id: str
- label: str
- department: str
- phone: str
- email: str
- location_ref: str
- source_refs[]: str
```

固定语义：

- contact refs 可以来自 guide 页面或 `contact_directory`
- contact refs 必须保留 source refs
- 如果用户只问电话、邮箱或部门联系方式，后续优先进入 `contact_directory_lookup`

## Conflict Record

```text
ServiceGuideConflictRecord
- conflict_id: str
- service_id: str
- field_path: str
- source_refs[]: str
- conflict_reason:
  - value_mismatch
  - stale_source
  - missing_effective_window
  - unsupported_transaction_claim
```

固定语义：

- 有 unresolved conflict 的 service record 不得作为 `resolved_current` 返回
- `unsupported_transaction_claim` 表示 source 暗示可办理或可预约，但当前产品边界只允许说明；
  builder 必须保留说明文本来源，不得生成 transaction fields

## Validation

以下情况必须阻断发布：

- `schema_version` 不匹配
- `generated_at` 非 RFC3339
- current artifact 内存在重复 `service_id`
- current-ready record 缺 `display_name`、`aliases`、`effective_from`、
  `effective_until` 或 `source_refs`
- section / material / entry / office hour / contact 缺 source refs
- `entry_type=online_url` 但 URL 非 http(s)
- record `effective_until <= effective_from`
- record `extraction_status != ready` 却被标记为 current-ready

以下情况进入 manual review，不写入 current-ready record：

- service alias 映射不稳定
- service procedure 缺步骤顺序
- required material 无法确认是否必需
- official-web 与 handbook source facts 冲突
- source 含“提交”“预约”“支付”“工单”等事务语义但无法拆成只读入口说明
- source refs 只能追溯到 OCR 片段，缺 canonical source-truth parent

## Query Runtime Consumption

Go structured query runtime 读取 current projection 后只做 deterministic query：

- alias match
- campus scope / audience filter
- temporal effective-window validation
- guide focus section selection
- candidate service clarification
- fail-close reason shaping

runtime 不做：

- LLM extraction
- raw source scan
- browser fetch
- form submit / booking / payment / work-order call
- generic retrieval secondary answer path

## Opening Gate

补齐本 schema 与 builder 只表示 data plane 具备真实 projection backing。产品主路径仍保持
gate-closed，直到 contract implementation、release-gate regression、eval evidence 与
app-owned typed observability summary 同时满足。
