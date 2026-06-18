---
doc_type: architecture
truth_scope: repository
owner_boundary: docs/architecture
status: active
created: 2026-04-02
updated: 2026-06-17
---
# 当前架构

## 文档边界

本文只负责描述 `campus-agent` 当前 accepted merged-truth architecture snapshot。

它回答的是：

- 当前前向产品拓扑是什么
- 当前哪些 serving surface 已开放
- 当前 `apps/*` 与 `packages/*` 的责任边界是什么
- 当前哪些文档负责目标架构与 supporting architecture

它不负责：

- 历史 phase 叙事
- 未合入分支实现进度
- backlog、ops closeout、release acceptance 或 planning work map
- collection-specific cleanup / eval / rebuild 细节
- 长期产品顶层入口 IA 的前向规划

## 当前拓扑

当前接受的主拓扑固定为：

`browser -> campus-web -> student campus experience / account shell`

`campus-web same-origin allowlisted /api/* -> app-api`

`browser -> campus-web Q&A -> app-api /api/chatkit -> chatkit-adapter ->
app-api chat conversation/run routes -> execution-control -> Temporal ->
workflow-worker / activity-worker-context / activity-worker-knowledge-plan /
activity-worker-knowledge-retrieval / activity-worker-knowledge-synthesis /
capability workers / activity-worker-finalization -> memory recall / typed
capability branch / Go RAG DTO/runtime -> Qdrant / provider / structured read
models -> sanitized projection`

`browser -> campus-web /docs/* -> Rspress-powered canonical reader /
current React docs shell`

`browser -> operator-console-web explicit allowlist proxy -> app-api -> request
projection / operator read model / operator-safe operations domains`

`collector -> app-api official_web control plane -> ingestion-control task admission`

`ingestion-control registry executor -> source truth / projection /
document/index release`

关键约束：

- browser 不直打 `apps/execution-control`
- `campus-web` 是当前学生侧 product entry surface 与 account browser shell，不是第二个
  product backend、generic app-api proxy 或 MediaWiki proxy
- `campus-web` Q&A 使用 OpenAI ChatKit 官方 CDN web component runtime；该外部 frontend
  runtime 是当前 accepted dependency，CSP 必须显式允许其 script/frame 资源
- Operator Console 的当前 implementation surfaces 不绕过 `apps/app-api`
- `campus-web` 与 Operator Console surfaces 到 `apps/app-api` 的 Worker-to-Worker
  调用走 `APP_API` Service Binding；
  `https://app-api.internal` 是内部 Request construction origin
- `apps/app-api` 是唯一 product-layer auth/session/principal owner
- `apps/chatkit-adapter` 是 internal ChatKit protocol adapter；它不拥有产品后端、
  conversation truth、execution truth、provider call 或 direct DB writes
- `apps/app-api` 当前是 neutral Identity Platform 的 canonical product owner；
  Better Auth 是 auth runtime adapter，不是产品账号、校园身份、access entitlement 或
  federation policy schema owner
- `api-staging.mucwiki-edge.link` 如存在，只表示 app-api staging machine / ops
  ingress，不是 browser surface upstream
- `apps/execution-control` 是 Go-owned internal execution engine，不是产品后端
- `apps/execution-control` 的部署 substrate 已冻结为 Docker-first internal execution service
- `apps/execution-control` 是当前 Docker execution-control service，负责
  internal workflow command/query、admission/policy gate、Temporal
  start/cancel/query seam、memory recall + RAG activity execution 与 sanitized
  projection writeback
- Temporal-backed chat execution path 已进入当前代码事实：`apps/app-api` 通过
  `/internal/execution/runs*` 调用 `apps/execution-control`，`apps/execution-control`
  启动 / 取消 `CapabilityExecutionWorkflow`，Temporal task queue 承担 execution substrate
- PG 不再是 online execution queue truth；`runtime.agent_runs`、run events 与 step
  tables 是 app-api / Operator Console / eval 消费的 sanitized run projection store
- retired PG lease tables、lane budget、worker heartbeat、PG lease worker loop 与
  recovery loop 只允许作为 historical migration artifact / retired code path 出现，
  不参与当前 online serving
- 当前在线主问答路径已进入 first Execution Agent decision / direct no-tool terminal
  branch：`CapabilityExecutionWorkflow` 执行
  `context.memory_recall -> agent.primary -> finalization.write`。
  `agent.primary` 由 `activity-worker-agent` 调用 `apps/agent-runtime`，后者使用
  OpenAI Agents SDK 承接模型-facing instructions、tool loop 与 direct/no-tool
  final output；Go `execution-control` 保留 durable envelope、Temporal timeout /
  cancel、memory projection refs、visible capability allowlist、sanitized
  `agent.primary` step projection 与 finalization ownership。
- 当前 ordinary chat 缺失 explicit capability hint 时保持 capability-neutral：
  `app-api` 允许 `requestedCapability=null`，Go `execution-control` 不再把缺失
  `requested_capability` 写成 `knowledge`，而是把 admitted visible tool set
  交给 `agent.primary` 决策。neutral memory recall 使用 `any` capability filter，
  direct/no-tool finalization 归因到 `primary_agent`。
- `plan.route -> capability branch` 不再是主问答链路的第一模型决策。它仍作为
  Go-owned deterministic structured planner / typed activity / historical RAG graph
  support path 保留，服务显式 typed branch、测试与内部 policy 约束；知识分支
  RAG graph 仍为 `rag.plan -> retrieval.indexed_lookup ->
  retrieval.expand_or_rescue -> evidence.selection -> synthesis ->
  grounding.verify`。
- 当前 online memory recall 由 `MemoryRecallActivity` 执行，使用 Hindsight self-host runtime；
  app-api chat submit 不再读取 PG `profile.memory_items` 并全量注入
  `context.profile_memory`。Qdrant 只承载 institutional RAG。
- Step attempt evidence spine 已进入当前代码事实：`runtime.agent_step_attempts`、
  execution-control `/steps`、app-api operator summary 与 Operator Console
  trajectory 已承载 activity metadata、queue wait、duration、provider/model、
  token/cost、cancel/timeout outcome 字段。`provider_execution_summary_v1` 与
  provider pricing readiness contract 已存在；activity timeout / context cancel
  可以投影为 first-class `bridge_timeout` / `activity_context_canceled` outcome。
- 当前 online RAG lookup 由 Go Qdrant native adapter 执行，Qdrant 仍是
  self-hosted authenticated private data-plane；embedding/provider 调用使用 Go
  cancellable HTTP context，synthesis provider execution 由
  `SynthesizeRAGAnswerActivity` 记录 `provider_execution_summary_v1`、usage、
  estimated cost 与 cancel / timeout outcome。
- 当前 cancel / timeout / late-completion 证据由 Temporal activity context、Go
  lookup/provider adapter、user cancel projection closeout 和 sanitized step attempt
  projection 承接；repo-local projection path 已能记录
  `activity_context_canceled`、`requested_before_start`、
  `provider_connection_aborted`、provider timeout 与 late completion ignored。
- Python `apps/supervisor-agent-worker` 已从 active workspace 删除；旧 bridge/server
  code 只可通过 git history 追溯，不得作为 staging readiness、online fallback 或
  active workflow branch 恢复。
- opened deterministic structured capability 必须作为 Go-owned typed Temporal
  activity 执行并写入 sanitized projection；未完成 worker contract 的 capability
  fail closed，不走 Python serving shortcut。
- online query path 与 offline data plane 持续分层
- `apps/app-api` 不拥有 official-web selected-write / release task state machine；
  claim、lease、retry、dead-letter、materialize、publish 与失败状态属于
  `apps/ingestion-control` 的 task lifecycle 与 registry-aware executor
- `wechat_official_account` 已进入 admitted source/data/control-plane truth：当前已有
  source-truth schema、collector principal、run ledger 与 offline projection handoff
  shape，但它不是默认 query-enabled surface，也不是近期已开放的 product runtime
- 当前 public product endpoint 固定为 `https://campus.muc.wiki`；staging browser endpoint
  固定为 `https://campus-staging.mucwiki-edge.link`。

## 当前 Serving Surface

当前 query-enabled surface 固定为：

- `regulations/student_rules`
- `regulations/institutional_rules`
- `curriculum/curriculum_plan`
- `official_web/stable_reference`

当前非默认公开查询面：

- `campus_notices/internal_notice` authenticated notice source-channel triage
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

### `apps/campus-web`

- public-facing Worker web surface for `campus.muc.wiki`
- 拥有学生侧主体验、校园应用入口、conversation/map/dining/feedback shell 与
  `/account/*` account browser shell
- 拥有 `/docs/*` docs browser route；当前 feature branch 已引入 Rspress-powered
  canonical reader build boundary，同时 React docs shell 仍保留为未 materialize reader route
  的临时错误/empty path
- 通过 allowlisted same-origin seam 与 Worker `APP_API` Service Binding 调用
  `apps/app-api` 的 `/api/me/*`、必要 `/api/auth/*`、implemented `/api/federation/*`、
  docs/chat/map/dining/feedback endpoints；Q&A 主线程通过 `/api/chatkit` 接入
  ChatKit custom server integration
- Q&A 主线程 UI、history/search、rename/delete、retry、stop 与 feedback 控件交给
  ChatKit；`campus-web` 只保留产品壳、账号 modal、支撑导航、错误边界和文案治理
- 不开放 generic `/api/*` proxy；未知 browser path fail-closed
- 不代理、镜像、迁移或重新服务 MediaWiki 页面内容、上传媒体或账号
- 不拥有 auth/session/principal/identity/federation truth；canonical identity 仍属于
  `apps/app-api`

### `apps/chatkit-adapter`

- internal FastAPI service that implements ChatKit custom server integration for
  `campus-web` Q&A
- 只做 ChatKit thread/item/action/event protocol adapter
- 通过 `apps/app-api` 的显式 conversation / run / feedback routes 读写产品真相
- 不生成 answer、不直连 `apps/execution-control`、不写 DB、不拥有 conversation truth
- 通过 `x-app-internal-auth` 与 signed campus principal headers 调用 `apps/app-api`

### `apps/operator-console-web`

- protected Worker web surface
- 负责 Operator Console 当前 operator domains 的 UI，包括 read-only
  observability / projection domains 与 dining operations workspace
- 通过 Worker `APP_API` Service Binding 消费 `apps/app-api` runtime-owned query
  surfaces 和 allowlisted operations routes
- 当前已接入 read-only observability、runtime health、`Requests`、`Official Web`、
  authenticated notice processing、dining operations 与 provider configuration surfaces
- 当前只 proxy explicitly allowlisted `/api/operator/*`、`/api/requests*`、
  `/api/official-web/*`、`/api/authenticated-notices/*` 与 `/api/ops/dining/*`
  routes into `apps/app-api`，不开放 generic `/api/*`
- 承载 dining draft / release candidate / release / audit workspace；不拥有 dining truth、
  auth/session truth 或第二套 operator backend
- `apps/app-api` 已有 `campus-services` operator routes，但当前 `operator-console-web`
  不承载校园服务校对与发布 workspace
- 它是唯一当前 Operator Console implementation package，不定义第二个长期后台产品概念

### `apps/app-api`

- shared Worker-native application/control-plane backend
- 拥有 auth、session、principal mapping、conversation truth、request ledger /
  projection input 与 selected operator surfaces
- 拥有 campus-web same-origin `/api/docs/*` 背后的 document reader control-plane truth
- 拥有 Better Auth email/password、password reset 与 Turnstile-backed auth admission
  hardening
- 拥有 Identity Platform 的 product-layer account / identity / access /
  preferences / federation policy boundary；当前 `/api/me/overview`、
  `/api/me/identity`、`/api/me/access`、`/api/me/preferences` 与
  `PATCH /api/me/preferences` 是 account center product projection surface
- 承接 `official_web` control plane
- 对 `official_web`，只拥有 collector command ingress、crawl-run ledger、operator
  projection/query 与 stable-reference release gate approve/reject ledger；不拥有
  selected-write admission/task truth 或 release executor callback surface
- 承接 authenticated notice processing 的 operator-safe projection ingest 与
  list/detail
  query；不暴露 raw notice content、OCR payload、附件字节、对象存储路径或 queue mutation
  action
- 承接 `wechat_official_account` source channel 的 command ingress、collector principal
  admission、run ledger 与 source artifact registration；当前只拥有 source/data/control-plane
  truth，不打开默认 product query/runtime serving
- 当前代码侧以 route exposure inventory 固定每个 route 的 caller class 与 admission rule

### `apps/execution-control`

- Docker-side internal execution ingress
- 暴露 `GET /healthz`、`GET /readyz`、`GET /metrics` 与
  `POST /internal/execution/runs`、`GET /internal/execution/runs/:runId`、
  `GET /internal/execution/runs/:runId/events`、
  `GET /internal/execution/runs/:runId/steps`、
  `POST /internal/execution/runs/:runId/cancel`
- 拥有 request body limit、caller auth、strict env parsing、request projection、
  Temporal workflow command/cancel、memory recall + RAG activity execution、
  sanitized projection writeback、timeout、readiness、metrics、OTel telemetry
  seam 与 graceful drain
- 当前 execution plane 已切为 self-hosted Temporal：`app-api` accepted chat
  request 调用 `execution-control` 创建 Temporal-backed run，Temporal
  workflow/activity worker 负责执行编排，PG `runtime.agent_runs` / events /
  step projection rows 只作为 app-api、panel、eval 读取的 sanitized product
  projection truth。旧 PG lease worker loop / recovery loop 不再参与 online
  serving。
- 当前 `CapabilityExecutionWorkflow` 主干已切为 `context.memory_recall ->
  agent.primary -> finalization.write` 或 `context.memory_recall ->
  agent.primary -> knowledge RAG graph -> finalization.write`。`agent.primary`
  通过 OpenAI Agents SDK 暴露 model-visible read-only tool catalog，由模型在
  agent loop 内决定是否调用工具；无工具请求可直接产出 final output。knowledge
  请求只向模型暴露 `knowledge_query` workflow-signal tool，实际 RAG 仍进入
  Go-owned Temporal graph；`retrieval.query` 不作为 model-visible tool 暴露。
  campus-services / notice read-only tools 通过 strict `tool-catalog.v1` 暴露给
  `agent.primary`，并由 execution-control internal query endpoint 执行；Go runtime
  通过 tool catalog / tool spec / endpoint drift test 约束可调用性。
  每个主干 step 写入
  `RunStep -> StepAttempt -> StepResult` projection。attempt projection 已包含
  Temporal activity metadata、queue wait、duration、provider/model、token/cost、
  cancel/timeout outcome 字段。
- 当前 public durable chat path 已具备 capability-neutral metadata、primary agent
  direct/no-tool terminal branch 与 agent-result finalization。`campus_services`
  与 `notice` 已有 model-visible read-only tool catalog 与 typed/internal-query
  bridge 基底。`navigation` 仍默认 closed，必须 fail closed。
- 进程内 lifecycle registry、active count 与 bounded queue 只保留为本进程
  runtime protection；它们不再是 durable execution truth，也不得被多实例叠加
  解释为全局 scheduler。
- 仍拥有 deterministic structured planner；当前实现位于
  `apps/execution-control/internal/structuredplanning`。`PlanRouteActivity` 从
  capability-neutral `execution_payload` 读取 user goal、requested capability、
  scope、version query 与 session context，输出 resolved capability branch steps。
  该能力当前不是主问答链路第一模型决策，而是 typed branch / RAG graph 的内部
  support path。
- `CapabilityExecutionWorkflow` 的当前主干由 primary agent SDK loop 承接工具选择
  与 direct answer；当 primary agent 选择 `knowledge_query` 时，workflow 使用
  agent result projection ref 作为 plan/dependency input 进入 Go RAG graph。
  保留的 resolved branch plan 仍可执行：knowledge step 进入 Go RAG graph；
  `campus_services` / `notice` step 进入 typed tool activity；
  selected-notice follow-through 可由 resolver 编译为 typed tool step + knowledge
  step。workflow trace / projection 只记录 bounded result refs、step metadata 与 safe
  summaries，不携带 raw projection payload。旧 bridge v6 `runtime_decisions` 不再是
  current durable chat path 的规划输入。
- 拥有 deterministic runtime policy；当前实现位于
  `apps/execution-control/internal/runtimepolicy`，负责 product scope gate、
  readiness / reject gate、context follow-up preflight、query-enabled scope
  admission 与 structured tool policy version；intent signal taxonomy、reason
  code 与 case-set version 当前由 `configs/runtime/intent-policy.v1.json`
  持有，Go runtime policy 加载该 artifact，并在缺失或 version drift 时
  fail-closed
- 拥有 runtime decision summary 与 typed activity projection；terminal response 由
  `app-api` 从 sanitized projection / run events closeout，不再由 execution-control
  同步 answer endpoint 返回
- 拥有 online runtime OTel trace owner 责任：`execution-control` 接收 trace context，
  发出 sanitized OTLP trace signal 到 Collector seam，并在 Collector/exporter 不可用时保持
  answer path fail-safe
- 拥有 Go-owned finalization 与 response-level observability projection
- 对已打开的 deterministic structured payload，只有具备 typed Temporal
  activity contract、projection contract 与 task queue poller 的 capability 才允许
  serving；缺 worker/config/poller 时 fail closed
- 不拥有 product-layer auth/session/conversation、browser-facing capability
  policy 或 agent semantic reasoning

### `apps/ingestion-control`

- internal ingestion/data-plane task control plane
- 拥有 task admission、registry validation、claim / lease、retry、dead-letter、
  closeout 与 operator-safe projection snapshot
- registry-aware executor 按 `ts_control` / `rust_kernel` 分派任务；未注册 handler /
  kernel 时 fail closed，不回退 Python collection CLI
- Python 只允许作为 explicit TS handler 内部调用的 MinerU / OCR / legacy Office /
  ML extraction adapter island

### `apps/ingestion-worker`

- Python adapter island
- 当前只保留 env bootstrap 与 legacy Office normalization adapter
- 不拥有 collection lifecycle、release / alias publish、Qdrant ops、source-channel
  queue consumer 或 on-demand batch runner

### `apps/official-web-collector`

- official web collector runtime
- 上报 crawl run lifecycle 与 artifact refs
- 不拥有 operator ledger、request projection 或 ingestion truth

## 当前 Package / Runtime 边界

- `apps/execution-control` 当前拥有 Go-owned knowledge / RAG Temporal activity graph，
  负责 retrieval-specific planning、evidence selection、grounded synthesis 与
  fail-close finalization runtime
- `packages/navigation-capability 是 navigation semantic specialist package；产品主路径对
  `place_lookup` 仍保持 fail-close，直到地图产品正式上线。deterministic place / point
  reads 必须先表现为 typed tool 或 internal query service；navigation specialist 只能作为
  typed `agent_step` / agent-as-tool 消费这些工具，不拥有 spatial source truth
- `packages/campus_services` 是 campus services semantic specialist package；当前
  capability family 覆盖 `service_status_lookup`、`service_guide_lookup`、
  `transport_schedule_lookup`、`contact_directory_lookup` 与
  `academic_calendar_lookup`。这些能力的 deterministic data access 默认是 typed tool /
  projection-backed internal query service；semantic specialist 只能在 typed
  `agent_step` / agent-as-tool 内消费工具输出。其中 `academic_calendar_lookup` 只消费
  `calendar/academic_calendar` projection-backed read model，支持教学周、命名校历事件区间、
  学期窗口与补课/调休上课事实，不负责校历查看入口说明
- repo-owned internal retrieval seam / Go RAG runtime 负责 retrieval abstraction、
  metadata pre-filter、evidence shaping；旧 Python `packages/retrieval-core` 已不属于
  active workspace
- `packages/ingestion-core` ingestion/data-plane consumption logic
- `packages/contracts` supervisor / capability handoff 与 shared typed seam

## 当前术语真相

- 当前 accepted merged truth 的 runtime / package / ADR label 继续以 current-truth
  名称为准：
  - `knowledge`
  - `navigation`
- 当前额外冻结的 forward family label 继续包括：
  - `campus_services`
  - `notice`
  这些 label 表示 semantic specialist family，不表示 deterministic source truth owner；
  notice / services / navigation 的默认实现入口必须是 typed tool 或 projection-backed
  internal query service，只有需要语义判断、消歧、摘要或跨工具编排时才进入 agent-as-tool。
- 对 `rag` / `navigation` 两条 capability family，forward family label 与 current
  runtime truth 已经对齐；active canonical surface 不再维护单独的 legacy
  current-truth alias。
- shared DTO 的 canonical Execution Agent Layer -> capability handoff 名称是
  `CapabilityRequest` / `CapabilityResponse`；active runtime / package
  implementation 叙述使用 capability dispatch / capability handoff。
- 未来新增 capability family 的命名规则与 reopen 条件，以已完成的
  `execution-capability-family-convergence` workstream 为准。

## 当前文档地图

- 产品定位：`docs/architecture/product-positioning.md`
- 当前架构：本文
- 目标架构：`docs/architecture/target-architecture.md`
- 产品/runtime supporting
  architecture：`docs/architecture/system/product-runtime-architecture.md`
- Execution Agent Layer supporting
  architecture：`docs/architecture/system/execution-agent-layer-architecture.md`
- prompt/instruction supporting
  architecture：`docs/architecture/system/prompt-and-instruction-architecture.md`
- account / operator access / memory binding supporting
  architecture：`docs/architecture/system/identity-and-authorization-architecture.md`
- identity platform supporting
  architecture：`docs/architecture/system/identity-platform-architecture.md`
- identity browser experience supporting
  architecture：`docs/architecture/system/identity-browser-experience-architecture.md`
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
- 当前 work map 与 backlog signals：`.planning/PROJECT.md`、
  `.planning/WORKSTREAMS.md`

## 不在本文维护的真相

以下内容不在本文维护：

- 最新 benchmark artifact、release gate 结果、当前工作焦点
- 历史 phase 排期与执行叙事
- collection-specific normalization / rebuild / eval 证据
- backlog、ops closeout、release acceptance 与 planning work map

这些分别以 `.planning/`、`docs/runbooks/`、`docs/reference/` 为准。
