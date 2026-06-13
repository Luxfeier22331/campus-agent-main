---
doc_type: architecture
truth_scope: capability
owner_boundary: domains/campus-services
status: active
created: 2026-04-23
updated: 2026-05-01
---
# Campus Services Runtime Architecture

## 文档边界

本文冻结 `campus_services` 的领域 supporting architecture。

它回答的是：

- `campus_services` 长期负责哪些结构化校园服务能力
- `transport_schedule_lookup`、`service_status_lookup`、`service_guide_lookup` 与后续
  contact / process runtime capability 应如何分层
- Execution Agent Layer、`campus_services`、`navigation`、query service 与 projection
  各自负责什么
- structured campus services runtime 为什么不能回退成 generic retrieval 或 query-time
  raw scan

它不负责：

- 当前产品主路径是否已经打开 `campus_services/*`
- 某一轮 workstream 的执行顺序
- 班车数据源、地图 provider 或某个具体 schedule parser 的实现细节
- operator UI 或 panel 卡片的像素设计

## Core Conclusion

长期上，`campus_services` 承接的是 projection-backed structured runtime
capability，而不是 generic retrieval 的一个 collection alias。

固定形态为：

```text
app-api -> execution-control -> Temporal activity -> capability worker
-> campus_services / typed tool -> internal query service
-> projection-backed structured truth
```

这意味着：

- tool 只是 `campus_services` 持有的 thin adapter
- runtime answer seam 是 repo-owned internal query service，不是 browser-facing API
- internal query service 只读 projection / normalized truth
- `campus_services` 不在 query time 回扫 raw source bundle、notice HTML 或通用 chunk
- `navigation` 可消费 point refs，但不拥有 timetable truth 或 service-status truth
- 在长期 multi-capability / agent-as-tool workflow 中，`campus_services`
  可以产出 bounded service / schedule facts 供 `notice`、`navigation` 或
  `knowledge` 消费，但不得把 raw read model rows、raw notice text 或
  unbounded source evidence 直接传给下游 agent

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
- `academic_calendar_lookup`
  - 回答第几教学周、学期日期窗口、节假日安排与补课/调休上课安排等校历事实
  - 只读 `calendar/academic_calendar` projection / typed read model；runtime
    owner 是 `campus_services`，data-plane owner 仍是
    `calendar/academic_calendar`

later-wave 已冻结方向包括：

- `service_process_lookup`
  - 回答已结构化的办理步骤、前置条件、材料、入口与办理节点
  - 只读，不生成可执行事务、预约、提交或工单 handoff

不属于 `campus_services` 的内容：

- 通用制度/流程问答
  - 继续属于 `knowledge`
- notice 发现与 canonical notice 阅读
  - 继续属于 `notice`
- 地点查找、路径规划、route geometry、spatial truth
  - 继续属于 `navigation`
- 事务执行、代办、提交、预约、支付、工单创建或任何状态变更
  - 当前中短期不进入产品规划；不得通过 tool handoff、表单自动化或 app-api loopback
    变相实现

## Owner Split

- Execution Agent Layer
  - 拥有 admission、capability routing、terminal semantics、clarification 分层
- `campus_services`
  - 拥有 campus-services family 内的 tool selection、service-specific clarification、
    structured answer shaping 与 fail-close policy
  - 在 manager-style multi-capability / agent-as-tool workflow 中产出 `ScheduleBaseline`、
    `ServiceGuideFacts`、`ServiceStatusFacts`、`ContactFacts` 等 bounded step output
    projection
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
  - `navigation` 只消费站点/地点引用，不拥有 timetable truth
- `contact_directory_lookup`
  - 只读 `campus_services/contact_directory` contact entity / entity-group projection
  - handbook 电话页、official-web 联系方式页与 future directory page 只作为 provenance 上游
  - handbook 电话页必须通过 `regulations/student_rules` declared projection fan-out 进入
    `campus_services/contact_directory` document artifacts，并由 ingestion/replay
    run 生成 structured contact projection；不得用单点脚本绕过 handbook ingestion/replay
  - 当前 Go structured query runtime 与 Python SDK executor seam 已落地，runtime profile
    为 `structured_query_serving`；正式 product rollout 仍以 release gate、`/readyz`
    preflight 与 E2E evidence 为准
- `service_guide_lookup`
  - 只读 `campus_services/service_guide` guide-oriented projection
  - procedure 类事实以 `procedure_groups` 为 canonical truth；
    `guide_sections.procedure` 只保留兼容摘要，不承担 query-time 反解析职责
  - 长期 runtime 通过 PostgreSQL `structured_projection_current` current pointer 与
    `service_guide_read_model` typed read model 读取当前 release
  - 文件 projection path runtime 已下线；本地 fixture / smoke / bootstrap
    也必须走 PostgreSQL release catalog 与 typed read model
  - handbook flow page、official-web 办事说明页与 future service entry page 只作为
    provenance 上游
  - handbook-derived first tracked source truth 已覆盖宿舍流程、公费医疗、学生证补办、
    学生申诉、临时困难补助、国家助学贷款与勤工助学岗位聘用；这些只作为
    `service_guide_lookup` 的 structured projection backing，不打开 generic retrieval
    默认 query scope 或事务型 product path
  - 只允许返回办理说明、材料、入口、适用人群、服务时间、联系方式与 source refs；
    不返回可执行 transaction payload，不生成 submission / booking / work-order handoff
- `service_catalog`
  - 只读 service discovery / alias governance projection
  - 第一版由 normalized `service_guide` 与可选 `contact_directory` projection 初始化
  - 不作为 query-serving fallback，不回读 raw PDF、portal HTML、notice HTML 或 generic
    retrieval chunk

固定约束：

- projection query 只读取 semantic-owner truth，不读 query-disabled retrieval alias
- `structured_query_serving` 只表示 admitted structured tool 可以消费 current
  projection/read model；它不等于 generic retrieval query-serving，也不绕过
  product opening gate
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
  `service_guide_lookup`；Execution Agent Layer 不得为这类请求生成事务型 execution handoff
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
  owner，serving stage 保持 `structured_query_serving`
- projection builder 离线生成 `campus_services_projection_bundle.v1`
- 周期性班次在 builder 侧展开 90 天服务日；Go runtime 不解析 recurrence
- versioned/current projection artifact 落在
  `campus_services/releases/transport_schedule/{release_id}/...`
- ingestion worker 发布 release 时同时写入 PostgreSQL release catalog、
  `structured_projection_current` current pointer 与 transport typed read model
- Docker runtime 读取 PostgreSQL current release + typed read model；文件 projection
  path 已下线
- Go `apps/execution-control` 不直接读对象存储、不持有对象存储凭据

这条数据面补全仍不打开产品主路径；它只是满足 backing query implementation 的前置条件。

## Operator-Maintained Source Channel

`campus_services` 接受人工校对来源作为第一版合法 upstream，但它必须通过 app-api ops
source channel 进入 release snapshot，不能绕过治理直接修改 serving read model。

固定规则：

- 导员口头通知、群消息、电话确认、现场确认与 operator curated 摘要可以作为
  `source_attestation`。
- app-api 只保存 operator-safe 摘要、校对说明、actor、时间窗与 release audit；不保存 raw chat、
  截图、附件字节、OCR payload、bucket 或 object key。
- 服务状态与班车临时变化必须落成 bounded `status_override` /
  `transport_override`，并通过 preview/publish 生成 current-effective release snapshot。
- preview 不写 release，不写 publish audit。
- publish 必须原子写入 release snapshot 与 audit event。
- runtime 仍保持 projection-backed structured truth；后续 typed lookup 读取 projection/read
  model，不在 query time 扫描 source attestation、notice HTML 或群消息摘要。
- 人工校对 channel 不表示 authenticated notice 自动消费、候选审阅、阻塞分析或发布任务证据已经成熟；
  这些仍应作为独立 notice/data-plane 能力推进。

HTTP contract 见 `docs/contracts/app-api-campus-services-ops-http.md`，数据边界见
`docs/data/campus-services-ops-source-truth-schema.md`。

## Relation To Retrieval And Notice

- `campus_services` 不并回 `knowledge`
- `campus_services/*` 即使不进入 generic retrieval 默认 query scope，也不意味着 runtime
  seam 应该回退成 generic retrieval
- structured campus services runtime 与 `official_web` / authenticated notice
  source-channel retrieval 可以并存，但不能互相冒充
- 如果某个问题需要 canonical notice 正文或公告发现，应明确切到 `notice`
- 如果某个问题只需要地点引用或路线展示，应明确切到 `navigation`
- 如果某个问题同时需要稳定班次基底与近期临时通知，应由 Execution Agent Layer workflow plan 显式串联
  `campus_services` 与 `notice`，再把 bounded `ScheduleBaseline` /
  `NoticeChangeSet` 交给 finalizer 或 `knowledge` grounding step；不得让任一 agent 在
  query time 回扫对方的 raw source

## Opening Gate

`campus_services` 的 owner package、thin adapter 与 handoff seam 已存在，不等于这条
runtime lane 已开放。

固定规则：

- opening gate 由 shared eval profile `campus-services-product-path` 驱动；artifact
  是产品路径 opening verdict 的唯一 machine-readable 入口
- rollout flag 仍由 Go runtime 持有：`EXECUTION_CONTROL_OPEN_CAPABILITIES`
- gate 未打开时，产品主路径必须保持 deterministic fail-close，不得回退 generic retrieval
- 不得通过 stub、link-only response 或 “先用 RAG 顶上” 伪装成能力已上线

## Public/chat Opening Verdict Snapshot (2026-04-27)

判定命令：

```bash
uv run --all-packages python -m scripts.eval_gate accept \
  --profile campus-services-product-path \
  --json
```

判定结果（local deterministic gate）：

- `service_status_lookup`: `open`
- `transport_schedule_lookup`: `open`
- `service_guide_lookup`: `open`
- `contact_directory_lookup`: `open`
- `service_process_lookup`: `keep_closed`（未在本轮 admission）

固定解释：

- local gate `PASS` 只表示“可进入 rollout 判定”，不自动等于 staging/prod 已开
- staging/prod 开放前必须额外满足：
  - `execution-control /readyz`：`capability_gates.campus_services.open=true`
  - `app-api/public-chat /readyz`：`preflight.campusServicesProductPath.status=ready`
- 若上述 preflight blocker 任一项退化，必须立即回滚 capability flag

## Runtime Tool Readiness Residual Backlog

Phase 6 后，这条线的产品路径缺口不再放在本架构文档分散维护；统一回写到
`campus-services-runtime-tool-gap-closeout`。

当前 residual backlog 只保留以下三类：

- staging opening evidence（真实部署、真实依赖、real traffic smoke）
- alias/clarification denominator 扩展（长尾口语、跨部门别称、边界提示词）
- `service_process_lookup` 的后续 admission（当前保持 `keep_closed`）

## Forbidden Shapes

- 不把班车/服务状态问题继续塞回 generic retrieval
- 不让 `navigation` 代持 timetable truth 或 service-status truth
- 不在 query time 扫描 raw source、notice bundle、portal HTML 或对象存储前缀
- 不通过 `app-api` loopback HTTP 充当 internal query seam
- 不把未通过 opening gate 的 runtime lane 冒充成已上线 product capability

## 相关稳定文档

- `docs/contracts/service-status-lookup-contract.md`
- `docs/contracts/transport-schedule-lookup-contract.md`
- `docs/contracts/contact-directory-lookup-contract.md`
- `docs/data/campus-services-transport-schedule-source-truth-schema.md`
- `docs/data/campus-services-contact-directory-source-truth-schema.md`
- `docs/architecture/system/tool-and-capability-runtime-architecture.md`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/architecture/system/capability-routing-and-admission-architecture.md`
- `docs/architecture/domains/navigation/architecture.md`
- `docs/architecture/current-architecture.md`
- `docs/architecture/target-architecture.md`
- `docs/reference/runtime-serving-and-index-terms.md`
