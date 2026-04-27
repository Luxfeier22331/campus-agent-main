---
doc_type: architecture
status: active
created: 2026-04-23
updated: 2026-04-27
---
# Campus Services Runtime Architecture

## 文档边界

本文冻结 `campus-services-agent` 的领域 supporting architecture。

它回答的是：

- `campus-services-agent` 长期负责哪些结构化校园服务能力
- `transport_schedule_lookup`、`service_status_lookup`、`service_guide_lookup` 与后续
  contact / process runtime capability 应如何分层
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

```text
app-api -> supervisor-api -> supervisor-agent-worker -> campus-services-agent
-> thin tool adapter -> internal query service -> projection-backed structured truth
```

这意味着：

- tool 只是 `campus-services-agent` 持有的 thin adapter
- runtime answer seam 是 repo-owned internal query service，不是 browser-facing API
- internal query service 只读 projection / normalized truth
- `campus-services-agent` 不在 query time 回扫 raw source bundle、notice HTML 或通用 chunk
- `navigation-agent` 可消费 point refs，但不拥有 timetable truth 或 service-status truth

## Capability Boundary

当前已冻结且已有 runtime backing prework 的 structured runtime capability 包括：

- `transport_schedule_lookup`
  - 回答地铁接驳车、跨校区通勤车等班次、方向、首末班、运营窗口与站点引用
- `service_status_lookup`
  - 回答服务开放时间、临时关闭、override、当前有效状态
- `service_guide_lookup`
  - 回答办理指南、材料、入口说明、服务时间、联系方式、适用范围与来源引用
  - 只读，不提交申请、不预约、不代办、不创建工单、不修改任何业务状态
- `contact_directory_lookup`
  - 回答部门电话、邮箱、办公地点、联系人与联系渠道

later-wave 已冻结方向包括：

- `service_process_lookup`
  - 回答已结构化的办理步骤、前置条件、材料、入口与办理节点
  - 只读，不生成可执行事务、预约、提交或工单 handoff

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
  - handbook 电话页必须通过 `regulations/student_rules` declared projection fan-out 进入
    `campus_services/contact_directory` document artifacts，并由 ingestion/replay
    run 生成 structured contact projection；不得用单点脚本绕过 handbook ingestion/replay
  - 当前 Go structured query runtime 与 Python thin adapter 已落地，产品 opening gate 仍保持
    closed；是否开放以 release gate + E2E verdict 为准
- `service_guide_lookup`
  - 只读 `campus_services/service_guide` guide-oriented projection
  - 长期 runtime 通过 PostgreSQL `structured_projection_current` current pointer 与
    `service_guide_read_model` typed read model 读取当前 release
  - 文件 projection path runtime fallback 已下线；本地 fixture / smoke / bootstrap
    也必须走 PostgreSQL release catalog 与 typed read model
  - handbook flow page、official-web 办事说明页与 future service entry page 只作为
    provenance 上游
  - handbook-derived first tracked source truth 已覆盖宿舍流程、公费医疗、学生证补办、
    学生申诉、临时困难补助、国家助学贷款与勤工助学岗位聘用；这些仍只是 offline
    projection backing，不打开产品主路径
  - 只允许返回办理说明、材料、入口、适用人群、服务时间、联系方式与 source refs；
    不返回可执行 transaction payload，不生成 submission / booking / work-order handoff
- `service_catalog`
  - 只读 service discovery / alias governance projection
  - 第一版由 normalized `service_guide` 与可选 `contact_directory` projection 初始化
  - 不作为 query-serving fallback，不回读 raw PDF、portal HTML、notice HTML 或 generic
    retrieval chunk

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
- ingestion worker 发布 release 时同时写入 PostgreSQL release catalog、
  `structured_projection_current` current pointer 与 transport typed read model
- Docker runtime 读取 PostgreSQL current release + typed read model；文件
  projection path fallback 已下线
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
  - Go `apps/supervisor-api` structured query runtime foundation；当前
    `service_status_lookup`、`transport_schedule_lookup` 与 `service_guide_lookup`
    均通过 PostgreSQL release current pointer + typed read model 消费，
    `transport_schedule_lookup` 具备 projection-backed schedule query kernel、
    Python thin-adapter wiring 与 authenticated-notice-backed offline projection
    builder，但仍不代表产品 serving surface 已打开
- gate 未打开时，产品主路径只能保持当前 routing truth 或 deterministic fail-close
- 不得通过 stub、link-only response 或 “先用 RAG 顶上” 伪装成能力已上线

## Runtime Tool Readiness And Gaps

以下缺口属于 product-path opening gate 与长期边界收口缺口，不改变
`campus-services-agent -> thin tool adapter -> internal query service -> projection-backed
structured truth` 的 owner shape。

### `service_status_lookup`

目标问题形态：

- 当前状态、临时调整、乘车点变更、开放 / 关闭、current-effective override

剩余缺口：

- service subject alias 覆盖仍需要扩展，尤其是用户用自然说法询问“班车乘车点”“卡务中心是否开门”
  这类对象时，必须稳定映射到 canonical service / subject，而不是退回 generic retrieval。
- status precedence 需要继续固化 regression：临时调整优先于常规状态，当前有效记录优先于历史记录，
  source 冲突或 currentness 不可证时 fail-close。
- `status_note` 的 answer shaping 还需要产品化，回答应展示用户可执行的事实，例如地点变更，
  不暴露内部 `notice_kind`、projection status 或 release id。
- source trace 与 observability 需要和 public/chat 入口打通，最终回答应能追溯到 source notice /
  projection release，同时只暴露 safe source summary。
- public/chat E2E 尚未固化为 release gate；planner、handoff、tool result 与最终 answer text
  需要在同一条真实请求路径上验证。

### `transport_schedule_lookup`

目标问题形态：

- 班车 / 接驳车时刻、方向、首班、末班、下一班、运营窗口、站点引用

剩余缺口：

- route / direction / stop alias 需要继续扩展，尤其是“丰台回海淀”“地铁接驳车”“通勤班车”
  这类短问法必须稳定落到具体 route 或触发 clarification。
- 长期线路、临时线路、临时站点调整与 schedule exception 的优先级需要更完整的 regression 覆盖；
  tool 只能消费已发布 projection，不应在 query time 重新解释原始 notice。
- date / time semantics 需要继续收口，包括指定日期、节假日、周末、寒暑假、当前时间之前/之后的
  “下一班”选择，以及 projection 展开窗口之外的 fail-close。
- OCR / table extraction 质量仍是 backing projection 风险；runtime 不修表格解析，只能在 projection
  缺关键字段时 fail-close，并通过 eval 暴露数据面缺口。
- 预约说明、办理入口这类 how-to 问题不应由 schedule tool 承担，应路由到
  `service_guide_lookup`。
- public/chat E2E 尚未覆盖 schedule answer 的最终渲染、operational notices 摘要与 source trace。

### `service_guide_lookup`

目标问题形态：

- 怎么办、需要什么材料、入口在哪里、办公时间、预约说明、只读办理指南

剩余缺口：

- service guide catalog 与 alias 覆盖仍薄，当前已能消费部分 notice-derived / handbook-derived
  guide，但还不是完整校园服务目录。
- guide section normalization 需要继续加强，材料、入口、办理地点、办公时间、适用人群、注意事项
  应尽量成为 typed fields，而不是只依赖长文本 section。
- 纯电话 / 邮箱 / 部门联系方式问题不应长期压在 `service_guide_lookup` 上；只有 guide projection
  已内嵌 source-linked contact refs 时才可展示；纯联系方式默认路由到
  `contact_directory_lookup`。
- 事务 guardrail 需要 E2E 验证：用户要求“帮我预约 / 代我提交 / 帮我办理”时，不能生成执行型
  handoff，只能回答只读流程或 fail-close。
- source refs、更新时间、适用范围与 unavailable / clarification 文案需要 product-path
  rendering gate。
- public/chat E2E 尚未覆盖 guide answer 的完整路径，尤其是“地铁接驳车怎么预约”“校园卡丢了怎么办”
  这类高频服务问题。

### `contact_directory_lookup`

目标问题形态：

- 部门电话、邮箱、办公地点、联系人、办公时间等稳定联系方式查询

剩余缺口：

- alias coverage 仍需扩展，尤其是“学院办公室”“招生咨询老师”“国际交流科”这类别称命中与歧义澄清。
- 当前只支持 `current/latest` 语义，`as_of` / 年份查询保持 fail-close；历史联系方式查询还未开放。
- conflict/manual-review source 命中时需要持续保持 fail-close，不得退回猜测或 fallback 文案。
- public/chat E2E 尚未覆盖 contact answer 的最终渲染、source trace 与 no-action boundary。

共同缺口：

- 四个 tool 都需要固定 deterministic eval denominator：planner/router、structured query result、
  agent adapter answer shaping、public/chat E2E。
- `campus-services-agent` 当前仍应保持 deterministic thin adapter。除非 eval 证明模板化 answer
  shaping 不足，否则不引入独立 LLM prompt 作为 correctness owner。

## Forbidden Shapes

- 不把班车/服务状态问题继续塞回 generic retrieval
- 不让 `navigation-agent` 代持 timetable truth 或 service-status truth
- 不在 query time 扫描 raw source、notice bundle、portal HTML 或对象存储前缀
- 不通过 `app-api` loopback HTTP 充当 internal query seam
- 不把当前未开放的 runtime lane 冒充成已上线 product capability

## 相关稳定文档

- `docs/contracts/service-status-lookup-contract.md`
- `docs/contracts/transport-schedule-lookup-contract.md`
- `docs/contracts/contact-directory-lookup-contract.md`
- `docs/data/campus-services-transport-schedule-source-truth-schema.md`
- `docs/data/campus-services-contact-directory-source-truth-schema.md`
- `docs/architecture/system/execution-and-agents-architecture.md`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/architecture/system/capability-routing-and-admission-architecture.md`
- `docs/architecture/domains/navigation/architecture.md`
- `docs/architecture/current-architecture.md`
- `docs/architecture/target-architecture.md`
- `docs/reference/runtime-serving-and-index-terms.md`
