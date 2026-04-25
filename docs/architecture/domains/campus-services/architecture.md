---
doc_type: architecture
status: active
created: 2026-04-23
updated: 2026-04-25
---
# Campus Services Runtime Architecture

## 文档边界

本文冻结 `campus-services-agent` 的领域 supporting architecture。

它回答的是：

- `campus-services-agent` 长期负责哪些结构化校园服务能力
- `transport_schedule_lookup`、`service_status_lookup` 与后续 service guide / contact
  runtime capability 应如何分层
- supervisor、`campus-services-agent`、`navigation-agent`、query service 与 projection
  各自负责什么
- structured campus services runtime 为什么不能回退成 generic retrieval 或 query-time
  raw scan

它不负责：

- 当前产品主路径是否已经打开 `campus_services/*`
- 某一轮 workstream 的执行顺序
- 班车数据源、地图 provider 或某个具体 schedule parser 的实现细节
- operator UI 或 panel 卡片的像素设计

## Core Conclusion

长期上，`campus-services-agent` 承接的是 projection-backed structured runtime
capability，而不是 generic retrieval 的一个 collection alias。

固定形态为：

`app-api -> supervisor-api -> supervisor-core -> campus-services-agent -> thin tool
adapter -> internal query service -> projection-backed structured truth`

这意味着：

- tool 只是 `campus-services-agent` 持有的 thin adapter
- runtime answer seam 是 repo-owned internal query service，不是 browser-facing API
- internal query service 只读 projection / normalized truth
- `campus-services-agent` 不在 query time 回扫 raw source bundle、notice HTML 或通用 chunk
- `navigation-agent` 可消费 point refs，但不拥有 timetable truth 或 service-status truth

## Capability Boundary

当前已冻结的 structured runtime capability 包括：

- `transport_schedule_lookup`
  - 回答地铁接驳车、跨校区通勤车等班次、方向、首末班、运营窗口与站点引用
- `service_status_lookup`
  - 回答服务开放时间、临时关闭、override、当前有效状态

later-wave 已冻结方向包括：

- `service_guide_lookup`
  - 回答办理指南、材料、入口说明、服务时间、联系方式、适用范围与来源引用
  - 只读，不提交申请、不预约、不代办、不创建工单、不修改任何业务状态
- `contact_directory_lookup`
  - 回答部门电话、邮箱、办公地点、联系人与联系渠道

不属于 `campus-services-agent` 的内容：

- 通用制度/流程问答
  - 继续属于 `rag-agent`
- notice 发现与 canonical notice 阅读
  - 继续属于 `notice-agent`
- 地点查找、路径规划、route geometry、spatial truth
  - 继续属于 `navigation-agent`
- 事务执行、代办、提交、预约、支付、工单创建或任何状态变更
  - 当前中短期不进入产品规划；不得通过 tool handoff、表单自动化或 app-api loopback
    变相实现

## Owner Split

- supervisor
  - 拥有 admission、capability routing、terminal semantics、clarification 分层
- `campus-services-agent`
  - 拥有 campus-services family 内的 tool selection、service-specific clarification、
    structured answer shaping 与 fail-close policy
- thin tool adapter
  - 只负责 typed request/response glue，不拥有业务语义
- internal query service
  - 只负责查询 admitted projection、应用 temporal semantics、返回 typed result
- projection / normalized truth
  - 负责 current-effective service state、route window、stop refs、
    service guide facts、contact facts

## Projection-Owned Query Shapes

- `service_status_lookup`
  - 只读 current-effective status projection
  - 不把 `service_catalog` 文本检索或 generic RAG 当作 runtime query seam
  - matched record 缺关键字段或 current effective window 已过期时必须
    fail-close，不得把历史/不完整记录冒充成当前状态
- `transport_schedule_lookup`
  - 只读 route / service window / stop ref projection
  - 方向、班次类型、当前时间语义必须由 code-owned query policy 解释
  - `navigation-agent` 只消费站点/地点引用，不拥有 timetable truth
- `contact_directory_lookup`
  - 只读 `campus_services/contact_directory` contact entity / entity-group projection
  - handbook 电话页、official-web 联系方式页与 future directory page 只作为 provenance 上游
- `service_guide_lookup`
  - 只读 `campus_services/service_guide` guide-oriented projection
  - handbook flow page、official-web 办事说明页与 future service entry page 只作为
    provenance 上游
  - 只允许返回办理说明、材料、入口、适用人群、服务时间、联系方式与 source refs；
    不返回可执行 transaction payload，不生成 submission / booking / work-order handoff

固定约束：

- projection query 只读取 semantic-owner truth，不读 query-disabled retrieval alias
- `current/latest/effective` 等 temporal semantics 必须是 code-owned routing/query truth
- alias ambiguity -> clarification
- currentness 不可证、projection 缺关键字段或 source 冲突 -> fail-close / unavailable

## Read-Only Service Guide Boundary

`service_guide_lookup` 面向“怎么申请 / 怎么办理 / 需要什么材料 / 在哪里办 / 办理时间 /
联系方式 / 服务入口说明”等只读信息查询。它的输出是 source-linked guide answer，不是可执行
workflow。

固定规则：

- “校园卡怎么申请”“宿舍报修怎么办理”“会议室预约流程是什么”属于
  `service_guide_lookup` 的目标问题形态
- “帮我提交申请”“替我预约会议室”“代我办理校园卡”不属于
  `service_guide_lookup`；supervisor 不得为这类请求生成事务型 execution handoff
- 若用户明确询问办理说明，可以进入 `service_guide_lookup`；若用户要求系统代办，则必须保持
  terminal guardrail / fail-close 语义，不能自动改写为执行动作
- 当 guide projection 缺失、过期、source refs 不可证或存在冲突时，runtime 返回
  `not_found` / `temporarily_unverifiable`，不得回退为 generic retrieval 编造流程

## Transport Schedule Data Plane

`transport_schedule_lookup` 的第一版真实 backing projection 固定由
`campus_services/transport_schedule` 拥有。

固定规则：

- 第一版只消费 `authenticated_notice_portal` notice source truth
- `configs/ingestion/campus_services/transport_schedule/` 是 collection runtime
  owner，serving stage 保持 `offline_preparation`
- projection builder 离线生成 `campus_services_projection_bundle.v1`
- 周期性班次在 builder 侧展开 90 天服务日；Go runtime 不解析 recurrence
- versioned/current projection artifact 落在
  `campus_services/releases/transport_schedule/{release_id}/...`
- Docker runtime 通过 `SUPERVISOR_STRUCTURED_QUERY_PROJECTION_PATH` 读取 mounted
  readonly current file
- Go `apps/supervisor-api` 不直接读对象存储、不持有对象存储凭据

这条数据面补全仍不打开产品主路径；它只是满足 backing query implementation 的前置条件。

## Relation To Retrieval And Notice

- `campus-services-agent` 不并回 `rag-agent`
- `campus_services/*` 即使仍处于 `offline_preparation`，也不意味着未来 runtime seam
  应该回退成 generic retrieval
- structured campus services runtime 与 `official_web` / authenticated notice
  source-channel retrieval 可以并存，但不能互相冒充
- 如果某个问题需要 canonical notice 正文或公告发现，应明确切到 `notice-agent`
- 如果某个问题只需要地点引用或路线展示，应明确切到 `navigation-agent`

## Opening Gate

`campus-services-agent` 的 owner package、thin adapter 与 handoff seam 已存在，不等于这条
runtime lane 已开放。

固定规则：

- opening gate 默认保持 closed，直到 backing query implementation、release-gate
  regression / eval evidence 与 app-owned typed observability summary 同时满足
- 当前 repo 已补齐 gate-closed prework：
  - `service_status_lookup` / `transport_schedule_lookup` shared contract
  - structured-runtime pre-routing helper
  - structured-runtime observability summary
  - Go `apps/supervisor-api` structured query runtime foundation；当前 `service_status_lookup`
    具备 file projection fixture backed foundation，`transport_schedule_lookup`
    具备 projection-backed schedule query kernel、Python thin-adapter wiring 与
    authenticated-notice-backed offline projection builder，但仍不代表产品 serving
    surface 已打开
- gate 未打开时，产品主路径只能保持当前 routing truth 或 deterministic fail-close
- 不得通过 stub、link-only response 或 “先用 RAG 顶上” 伪装成能力已上线

## Forbidden Shapes

- 不把班车/服务状态问题继续塞回 generic retrieval
- 不让 `navigation-agent` 代持 timetable truth 或 service-status truth
- 不在 query time 扫描 raw source、notice bundle、portal HTML 或对象存储前缀
- 不通过 `app-api` loopback HTTP 充当 internal query seam
- 不把当前未开放的 runtime lane 冒充成已上线 product capability

## 相关稳定文档

- `docs/contracts/service-status-lookup-contract.md`
- `docs/contracts/transport-schedule-lookup-contract.md`
- `docs/data/campus-services-transport-schedule-source-truth-schema.md`
- `docs/architecture/system/execution-and-agents-architecture.md`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/architecture/system/capability-routing-and-admission-architecture.md`
- `docs/architecture/domains/navigation/architecture.md`
- `docs/architecture/current-architecture.md`
- `docs/architecture/target-architecture.md`
- `docs/reference/runtime-serving-and-index-terms.md`
