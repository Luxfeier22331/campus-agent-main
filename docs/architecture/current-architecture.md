---
doc_type: architecture
status: active
created: 2026-04-02
updated: 2026-05-07
---
# 当前架构

## 文档边界

本文只负责描述 `campus-agent` 当前 accepted merged-truth architecture snapshot。

它回答的是：

- 当前前向产品拓扑是什么
- 当前哪些 serving surface 已开放
- 当前 `apps/*` 与 `packages/*` 的责任边界是什么
- 当前哪些文档负责目标架构、supporting architecture 与执行状态

它不负责：

- 历史 phase 叙事
- 未合入分支实现进度
- collection-specific cleanup / eval / rebuild 细节
- 长期产品顶层入口 IA 的前向规划

## 当前拓扑

当前接受的主拓扑固定为：

`browser -> hub-web -> app launcher / account shell`

`hub-web same-site allowlisted /api/* -> app-api`

`browser -> public-chat-web -> app-api -> supervisor-api ->
supervisor-agent-worker
private bridge -> agent`

`browser -> public-docs static reader assets`

`browser -> public-docs same-site /api/docs/* -> app-api docs control plane`

`browser -> protected-panel-web -> app-api -> request projection / operator read
model`

`collector -> app-api official_web control plane -> ingestion-worker`

`ingestion-worker -> ingestion-core release task -> source truth / projection /
document/index release`

关键约束：

- browser 不直打 `apps/supervisor-api`
- hub 是 product entry surface，不是第二个 product backend、generic app-api proxy
  或 MediaWiki proxy
- panel 不绕过 `apps/app-api`
- hub / public chat / docs / panel 到 `apps/app-api` 的 Worker-to-Worker 调用走
  `APP_API`
  Service Binding；`https://app-api.internal` 是内部 Request construction origin
- `apps/app-api` 是唯一 product-layer auth/session/principal owner
- `apps/app-api` 当前同时是 MUC Wiki Hub Identity Platform 的 canonical product owner；
  Better Auth 是 auth runtime adapter，不是产品账号、校园身份、access entitlement 或
  federation policy schema owner
- `api-staging.mucwiki-edge.link` 如存在，只表示 app-api staging machine / ops
  ingress，不是 browser surface upstream
- `apps/supervisor-api` 是 Go-owned internal execution engine，不是产品后端
- `apps/supervisor-api` 的部署 substrate 已冻结为 Docker-first internal execution
  service
- `apps/supervisor-api` 是当前 Docker execution ingress，负责 execution HTTP surface
  与 runtime hardening；Python `apps/supervisor-agent-worker` 只保留 private bridge
  worker
- semantic delegate path 仍进入 Python private bridge；已打开的 deterministic
  structured capability 当前按 `runtime_posture` 分流：
  `typed_handoff_only` 的 payload 允许在 Go `apps/supervisor-api` 的 non-stream
  answer
  path 与 lifecycle SSE answer path 直接完成，`sdk_adapter_admitted` 的 payload 则进入
  Go-owned `single_handoff` plan，再由 Python worker 的 SDK-native agent runtime 执行
- Python bridge 返回 private `AgentResponse`；public `SupervisorResponse`
  finalization 与 response observability projection 由 Go `apps/supervisor-api` 执行
- online query path 与 offline data plane 持续分层
- `apps/app-api` 不拥有 official-web selected-write / release task state machine；
  claim、lease、retry、dead-letter、materialize、publish 与失败状态属于
  `packages/ingestion-core` / `apps/ingestion-worker`
- `wechat_official_account` 已进入 admitted source/data/control-plane truth：当前已有
  source-truth schema、collector principal、run ledger 与 offline projection
  handoff
  shape，但它不是默认 query-enabled surface，也不是近期已开放的 product runtime
- 本文列出的当前 browser surfaces 只描述当前 merged truth，不定义长期“哪个入口应作为产品首页”

## 当前 Serving Surface

当前 query-enabled surface 固定为：

- `regulations/student_rules`
- `regulations/institutional_rules`
- `curriculum/curriculum_plan`
- `official_web/stable_reference`

当前非默认公开查询面：

- `campus_notices/internal_notice` restricted source-channel triage
  collection；当前 posture 仍是 `offline_preparation`，wrapper notices 继续留在这里，而不是直接进入
  `regulations/*`
- `regulations/scoped_rules` notice-derived scoped-rule holding collection；当前
  posture 已进入 retrieval-ready `query_serving` data plane，但仍保持
  `query_enabled_by_default=false`，repo 已冻结其作为 `annual_cycle_rule` /
  `time_bound_operational_rule` 的统一下游承接面；默认用户入口仍不放行这个 scope
- `curriculum/course_facts` agent-internal retrieval
  surface；`retrieval_enabled=true`，`query_enabled_by_default=false`
- `curriculum/program_family_facts` agent-internal retrieval surface；用于培养方案家族成员关
  系与别名治理，`retrieval_enabled=true`，`query_enabled_by_default=false`
- `curriculum/program_semester_facts` agent-internal retrieval surface；用于
  single-program + single-semester
  课程事实检索，`retrieval_enabled=true`，`query_enabled_by_default=false`
- `campus_services/service_status`、`campus_services/service_guide`、
  `campus_services/contact_directory`、`campus_services/transport_schedule` 与
  `calendar/academic_calendar` 当前保持 `structured_query_serving`：只通过 admitted
  structured tools 消费 current projection/read model，不进入 generic retrieval 默认
  query scope；`campus_services/service_catalog` 仍保持 `offline_preparation`

当前非 serving capture-only scope：

- `campus_notices/file_release_capture` authenticated notice `file_release`
  local-PG-only inventory / raw-asset ledger；用于 owner-recovery readiness 与
  operator 排障，`query_enabled=false`，不生成 document / chunk / index / release

## 当前 App 边界

### `apps/hub-web`

- public-facing Worker web surface for `hub.muc.wiki`
- 拥有 `/` app launcher shell、launcher route registry 与 `/account` account shell
- 通过 allowlisted same-site seam 与 Worker `APP_API` Service Binding 调用
  `apps/app-api`
  的 `/api/me` 与必要 auth endpoints
- `/account` 当前消费 compact `/api/me` runtime principal；forward account center 应切到
  Identity Platform product projection，而不是围绕 Better Auth raw session 建模
- sibling app entries 只能表现为 registry 中的 `app_link` / `planned` / `external`
  target，不创建 `/chat`、`/docs`、`/panel`、`/map`、`/services` 或 `/notices`
  这类 fake internal browser route shell
- 不开放 generic `/api/*` proxy；未知 browser path fail-closed
- `muc-wiki` 只是指向 `https://muc.wiki` 的 MUC Wiki 主站 external card；`/wiki`
  不是 internal hub slug
- 不代理、镜像、迁移或重新服务 MediaWiki 页面内容、上传媒体或账号
- 不拥有 auth/session/principal truth；canonical identity 仍属于 `apps/app-api`

### `apps/public-chat-web`

- public-facing Worker web surface
- 当前保留 `/login`、`/register`、`/forgot-password`、`/reset-password`
  作为 bounded compatibility redirects/shims 到 hub account routes
- 只负责 browser route shell 与 chat UI
- 不再拥有 public auth/account shell、captcha widget 或 password-reset form runtime
- browser auth handoff 固定为
  `public-chat-web compat route -> hub-web /account/* -> same-site /api/auth/*`
  -> `app-api`
- 通过 same-site/internal seam 与 Worker `APP_API` Service Binding 调用
  `apps/app-api`

### `apps/public-docs`

- public-facing Worker docs surface
- 当前正式拥有公开文档站 shell 与公开文档阅读入口
- 当前以 `Rspress` 壳提供导航与阅读面，并通过 Worker `APP_API` Service Binding 将
  same-site `/api/docs/*` 转发到 `apps/app-api`
- 非 `/api/docs/*` 的 `/api/*` 不开放为通用 app-api proxy；文档站只拥有 docs control-plane
  consumption seam
- public reader 静态资产由 Worker `ASSETS` binding 交付，HTML shell 默认 `no-store`
- 不拥有 auth/session/principal truth，也不自行成为 docs visibility / version 的长期 owner

### `apps/protected-panel-web`

- protected Worker web surface
- 只负责 operator-facing panel UI
- 通过 Worker `APP_API` Service Binding 消费 `apps/app-api` runtime-owned query
  surfaces
- 当前已接入 `Requests`、`Official Web` 与 authenticated notice processing 的 app-owned
  operator-safe read-only surfaces

### `apps/app-api`

- shared Worker-native application/control-plane backend
- 拥有 auth、session、principal mapping、conversation truth、request ledger /
  projection input 与 selected operator surfaces
- 拥有 public-docs same-site `/api/docs/*` 背后的 document reader control-plane truth
- 拥有 Better Auth email/password、password reset 与 Turnstile-backed auth admission
  hardening
- 拥有 Identity Platform 的 product-layer account / identity / access /
  preferences / federation policy boundary；当前 `/api/me/overview` 与 federation
  endpoints 是已冻结 forward contract，尚不得写成 current route inventory
- 承接 `official_web` control plane
- 对 `official_web`，只拥有 collector command ingress、crawl-run ledger、operator
  projection/query 与 stable-reference release gate approve/reject ledger；不拥有
  selected-write admission/task truth 或 release executor callback surface
- 承接 authenticated notice processing 的 operator-safe projection ingest 与
  list/detail
  query；不暴露 raw notice content、OCR payload、附件字节、对象存储路径或 queue mutation
  action
- 承接 `wechat_official_account` source channel 的 command ingress、collector
  principal
  admission、run ledger 与 source artifact registration；当前只拥有
  source/data/control-plane
  truth，不打开默认 product query/runtime serving
- 当前代码侧以 route exposure inventory 固定每个 route 的 caller class 与 admission rule

### `apps/supervisor-api`

- Docker-side internal execution ingress
- 暴露 `GET /healthz`、`GET /readyz`、`GET /metrics` 与
  `POST /api/v1/answer`、`POST /api/v1/answer/stream`、
  `POST /internal/execution/cancel`
- 拥有 request body / bridge response limit、caller auth、strict env parsing、
  request projection、in-flight lifecycle、explicit cancel、global / per-lane
  execution admission、bounded queue、timeout、readiness、metrics、OTel telemetry
  seam 与 graceful drain
- 拥有 deterministic structured planner；当前实现位于
  `apps/supervisor-api/internal/structuredplanning`，`internal/execution`
  仅负责把 planner 输出适配成 bridge v6 `runtime_decisions`
- `runtime_decisions.workflow_plan` 已作为 planner 的 canonical safe projection
  落入 bridge contract；当前 runtime 默认只发出 `single_handoff` plan。受控开启
  `SUPERVISOR_API_MULTI_STEP_WORKFLOW_ENABLED=true` 且 workflow run store ready
  后，
  可执行首条真实 `multi_step` path：selected notice context + knowledge follow-through
  触发 notice-agent internal selected notice resolve
  (`payload_kind=campus_notice_get`) -> `rag-agent retrieval.query`，并将 notice
  step 输出以 bounded internal workflow context projection 传给 RAG step。该 path 现已
  改为 planner 输出 internal `CapabilityPlan`，再由 artifact-registry resolver 编译
  `WorkflowPlan`；planner 不再手写 notice -> rag 固定 step shell。Go finalizer 同时在
  `workflow_trace_summary` 中记录 `answer_artifact_projection_ids` 与
  `answer_artifact_kinds`，用于证明最终答复使用了哪些 bounded artifact
- 拥有 deterministic runtime policy；当前实现位于
  `apps/supervisor-api/internal/runtimepolicy`，负责 product scope gate、
  approval / reject gate、context follow-up preflight、query-enabled scope
  admission 与 structured tool policy version；intent signal taxonomy、reason
  code 与 case-set version 当前由 `configs/runtime/intent-policy.v1.json`
  持有，Go runtime policy 加载该 artifact，并在缺失或 version drift 时
  fail-closed
- 拥有 non-delegate terminal envelope 与 runtime decision summary；non-stream /
  lifecycle SSE answer path 会直接在 Go 中返回 terminal supervisor-style response；
  metrics、OTel 与 execution audit 使用同一组低基数 runtime policy labels
- 拥有 online runtime OTel trace owner 责任：`supervisor-api` 接收 trace context，
  发出 sanitized OTLP trace signal 到 Collector seam，并在 Collector/exporter 不可用时保持
  answer path fail-safe
- 拥有 private bridge `AgentResponse -> SupervisorResponse` finalization 与
  response-level observability projection
- 对已打开的 deterministic structured payload，只有 ToolSpec
  `runtime_posture=typed_handoff_only` 的 payload 才允许在 non-stream
  `/api/v1/answer` 与 lifecycle SSE `/api/v1/answer/stream` 直接执行 Go structured
  runtime 并返回 supervisor-style response；`runtime_posture=sdk_adapter_admitted` 的
  payload 进入 Go-owned `single_handoff` plan，再由 Python worker 的 Agents SDK native
  substrate 执行
- 通过 private bridge 调用 Python `apps/supervisor-agent-worker`
- 不拥有 product-layer auth/session/conversation、browser-facing capability
  policy 或 agent semantic reasoning

### `apps/supervisor-agent-worker`

- Docker-first internal execution service 的 Python orchestration worker
- 只接收 Go `supervisor-api` 已投影的 private bridge v6 delegate request
- 装配默认 agent delegate map，并通过 worker 内部 `AgentDispatcher` 调用 agent
- 只返回 `AgentResponse` 给 Go bridge；不再组装 public `SupervisorResponse`
- 不再暴露 public `/api/v1/answer`；execution transport、admission、queue、
  metrics 与 published `transport_runtime` 由 `apps/supervisor-api` 拥有
- 对 delegate request，bridge v6 parser 要求
  `runtime_decisions.workflow_plan` 与
  `runtime_decisions.handoff.agent_request.workflow_context` 同时存在，并校验二者的
  step、target、payload kind、allowed tools、projection kind 与 expected artifacts
  一致；Python 不再在 query time 发明 cross-agent route order
- 当前 provider-facing semantic runtime 已收口到 OpenAI Agents SDK native substrate：
  structured domain-agent execution 通过 ToolSpec 派生的 SDK `FunctionTool`，RAG
  answer synthesis 通过 `OpenAIAgentsRagRuntime`；SDK 不接管 Go admission、
  WorkflowPlan、ToolSpec、budget、policy 或 finalization
- SDK dependency、provider、model 或 API key 缺失时，worker readiness 以稳定原因降级并
  fail closed；不启用 non-SDK answer fallback
- 拥有 worker-side retrieval runtime observation bridge，把
  `retrieval.runtime_observation` 投影成 sanitized runtime event sink；不把 raw
  query / snippet / document body 写入 telemetry

### `apps/ingestion-worker`

- offline ingestion/data-plane executor
- 承接 source-truth / projection / chunk / index write path
- 拥有 official-web release task runtime；从 ingestion-owned task payload 推进
  selected-write / stable-reference release，不通过 app-api executor route 回写状态
- 拥有 ingestion run-level telemetry adapter，输出 canonicalize / chunk / embedding /
  index release / publish / audit 的 sanitized started/completed/failed run
  event；
  export failure 不让 ingestion job 失败

### `apps/official-web-collector`

- official web collector runtime
- 上报 crawl run lifecycle 与 artifact refs
- 不拥有 operator ledger、request projection 或 ingestion truth

## 当前 Package 边界

- `packages/rag-agent` 当前默认 knowledge agent，负责 retrieval-specific
  planning、clarification、grounded answer synthesis
- `packages/navigation-agent` 已接受的 navigation capability boundary；当前 package /
  contract truth 存在，但产品主路径对 `place_lookup` 仍保持 fail-close，直到地图产品正式上线
- `packages/campus-services-agent` 是 campus services structured runtime
  boundary；当前同时承接 `service_status_lookup`、`service_guide_lookup`、
  `transport_schedule_lookup`、`contact_directory_lookup` 与
  `academic_calendar_lookup`。其中 `academic_calendar_lookup` 只消费
  `calendar/academic_calendar` projection-backed read model，支持教学周、
  命名校历事件区间、学期窗口与补课/调休上课事实，不负责校历查看入口说明
- `packages/retrieval-core` retrieval abstraction、metadata pre-filter、evidence
  shaping
- `packages/ingestion-core` ingestion/data-plane consumption logic
- `packages/contracts` supervisor / agent handoff 与 shared typed seam

## 当前术语真相

- 当前 accepted merged truth 的 runtime / package / ADR label 继续以 current-truth
  名称为准：
  - `rag-agent`
  - `navigation-agent`
- 当前额外冻结的 forward family label 继续包括：
  - `campus-services-agent`
  - `notice-agent`
- 对 `rag` / `navigation` 两条 capability family，forward family label 与 current
  runtime truth 已经对齐；active canonical surface 不再维护单独的 legacy
  current-truth alias。
- shared DTO 的 canonical supervisor -> agent handoff 名称是 `AgentRequest` /
  `AgentResponse`；active runtime / package implementation 叙述使用 agent dispatch /
  agent handoff。
- 未来新增 capability family 的命名规则与 reopen 条件，以已完成的
  `execution-capability-family-convergence` workstream 为准。

## 当前文档地图

- 产品定位：`docs/architecture/product-positioning.md`
- 当前架构：本文
- 目标架构：`docs/architecture/target-architecture.md`
- 产品/runtime supporting
  architecture：`docs/architecture/system/product-runtime-architecture.md`
- execution/agent supporting
  architecture：`docs/architecture/system/execution-and-agents-architecture.md`
- prompt/instruction supporting
  architecture：`docs/architecture/system/prompt-and-instruction-architecture.md`
- identity / authorization supporting
  architecture：`docs/architecture/system/identity-and-authorization-architecture.md`
- identity platform supporting
  architecture：`docs/architecture/system/identity-platform-architecture.md`
- hub account experience supporting
  architecture：`docs/architecture/system/hub-account-experience-architecture.md`
- future muc.wiki federation supporting
  architecture：`docs/architecture/system/federation-and-mucwiki-login-architecture.md`
- retrieval / serving supporting
  architecture：`docs/architecture/system/retrieval-serving-architecture.md`
- data plane supporting
  architecture：`docs/architecture/system/data-plane-architecture.md`
- shared file asset supporting
  architecture：`docs/architecture/system/file-asset-loader-architecture.md`
- campus services structured runtime supporting
  architecture：`docs/architecture/domains/campus-services/architecture.md`
- `official_web` supporting
  architecture：`docs/architecture/domains/official-web/architecture.md`
- authenticated notice source supporting
  architecture：`docs/architecture/domains/authenticated-notice/architecture.md`
- operator observability supporting
  architecture：`docs/architecture/system/operator-observability-architecture.md`
- 当前 phase / pending work：`.planning/PROJECT.md`、`.planning/WORKSTREAMS.md` 与对应
  workstream `STATE.md`

## 不在本文维护的真相

以下内容不在本文维护：

- 最新 benchmark artifact、release gate 结果、current focus
- 历史 phase 排期与执行叙事
- collection-specific normalization / rebuild / eval 证据

这些分别以 `.planning/`、`docs/runbooks/`、`docs/reference/` 为准。
