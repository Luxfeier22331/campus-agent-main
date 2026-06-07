---
doc_type: architecture
status: active
created: 2026-04-02
updated: 2026-06-08
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

`browser -> public-chat-web -> app-api -> execution-control -> Temporal -> activity
worker -> supervisor-agent-worker private bridge -> rag-agent / retrieval-core`

`browser -> public-docs static reader assets`

`browser -> public-docs same-site /api/docs/* -> app-api docs control plane`

`browser -> protected-panel-web -> app-api -> request projection / operator read
model`

`collector -> app-api official_web control plane -> ingestion-worker`

`ingestion-worker -> ingestion-core release task -> source truth / projection /
document/index release`

关键约束：

- browser 不直打 `apps/execution-control`
- hub 是 product entry surface，不是第二个 product backend、generic app-api proxy
  或 MediaWiki proxy
- panel 不绕过 `apps/app-api`
- hub / public chat / docs / panel 到 `apps/app-api` 的 Worker-to-Worker 调用走 `APP_API`
  Service Binding；`https://app-api.internal` 是内部 Request construction origin
- `apps/app-api` 是唯一 product-layer auth/session/principal owner
- `api-staging.mucwiki-edge.link` 如存在，只表示 app-api staging machine / ops
  ingress，不是 browser surface upstream
- `apps/execution-control` 是 Go-owned internal execution engine，不是产品后端
- `apps/execution-control` 的部署 substrate 已冻结为 Docker-first internal execution service
- `apps/execution-control` 是当前 Docker execution-control service，负责
  internal workflow command/query、admission/policy gate、Temporal
  start/cancel/query seam 与 sanitized projection writeback；Python
  `apps/supervisor-agent-worker` 只保留 private semantic bridge worker
- Temporal-backed chat execution path 已进入当前代码事实：`apps/app-api` 通过
  `/internal/execution/runs*` 调用 `apps/execution-control`，`apps/execution-control`
  启动 / 取消 `ChatAnswerWorkflow`，Temporal task queue 承担 execution substrate
- PG 不再是 online execution queue truth；`runtime.agent_runs`、run events 与 step
  tables 是 app-api / panel / eval 消费的 sanitized run projection store
- retired PG lease tables、lane budget、worker heartbeat、PG lease worker loop 与
  recovery loop 只允许作为 historical migration artifact / retired code path 出现，
  不参与当前 online serving
- 当前在线 RAG 路径仍包含 Python `apps/supervisor-agent-worker` private bridge；该 bridge 是
  current implementation gap，不是长期 online answer hot path 目标。当前 bridge runtime 默认单
  worker execution 模型会限制并发，除非部署侧显式配置 worker concurrency。
- 当前 Temporal chat workflow 仍是粗粒度 step trajectory：`planning`、
  `semantic.rag`、`finalization`。RAG package 内部已有 planner / retrieval /
  evidence selection / synthesis / grounding 诊断概念，但它们尚未全部提升为
  Temporal-visible durable step graph。
- 当前 cancel / timeout 已进入 Go -> Python cooperative cancel path；但 provider
  in-flight request hard-abort 尚不能被 projection 证明。token / estimated cost 字段已经
  存在于 contract model，在线 provider usage extraction、latency / token / cost
  projection 与 cancel 后停止继续 token 消耗的证据闭环仍是 implementation gap。
- 当前仍未完成的是 worker plane 全量收口、step-level projection 全量消费、worker
  autoscaler、Temporal poller proof 与 typed-tool capability worker 全量拆分。目标 durable
  runtime 见 `docs/architecture/system/durable-agent-runtime-architecture.md`
- semantic delegate path 仍进入 Python private bridge；已打开的 deterministic
  structured capability 当前按 `runtime_posture` 分流：
  `typed_handoff_only` 的 payload 允许在 Go `apps/execution-control` 的 non-stream answer
  path 与 lifecycle SSE answer path 直接完成，`sdk_adapter_admitted` 的 payload 则进入
  Go-owned `single_step` plan，再由 Python worker 的 SDK-native agent runtime 执行
- Python bridge 返回 private `AgentResponse`；public `SupervisorResponse`
  finalization 与 response observability projection 由 Go
  `apps/execution-control` 执行
- online query path 与 offline data plane 持续分层
- `apps/app-api` 不拥有 official-web selected-write / release task state machine；
  claim、lease、retry、dead-letter、materialize、publish 与失败状态属于
  `packages/ingestion-core` / `apps/ingestion-worker`
- `wechat_official_account` 已进入 admitted source/data/control-plane truth：当前已有
  source-truth schema、collector principal、run ledger 与 offline projection handoff
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
- 通过 allowlisted same-site seam 与 Worker `APP_API` Service Binding 调用 `apps/app-api`
  的 `/api/me` 与必要 auth endpoints
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
- 通过 same-site/internal seam 与 Worker `APP_API` Service Binding 调用 `apps/app-api`

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
- 通过 Worker `APP_API` Service Binding 消费 `apps/app-api` runtime-owned query surfaces
- 当前已接入 `Requests`、`Official Web` 与 authenticated notice processing 的 app-owned
  operator-safe read-only surfaces

### `apps/app-api`

- shared Worker-native application/control-plane backend
- 拥有 auth、session、principal mapping、conversation truth、request ledger /
  projection input 与 selected operator surfaces
- 拥有 public-docs same-site `/api/docs/*` 背后的 document reader control-plane truth
- 拥有 Better Auth email/password、password reset 与 Turnstile-backed auth admission
  hardening
- 承接 `official_web` control plane
- 对 `official_web`，只拥有 collector command ingress、crawl-run ledger、operator
  projection/query 与 stable-reference release gate approve/reject ledger；不拥有
  selected-write admission/task truth 或 release executor callback surface
- 承接 authenticated notice processing 的 operator-safe projection ingest 与 list/detail
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
  `POST /internal/execution/runs/:runId/cancel`、
  `POST /internal/execution/cancel`
- 拥有 request body / bridge response limit、caller auth、strict env parsing、
  request projection、Temporal workflow command/cancel、sanitized projection
  writeback、timeout、readiness、metrics、OTel telemetry seam 与 graceful drain
- 当前 execution plane 已切为 self-hosted Temporal：`app-api` accepted chat
  request 调用 `execution-control` 创建 Temporal-backed run，Temporal
  workflow/activity worker 负责执行编排，PG `runtime.agent_runs` / events /
  step projection rows 只作为 app-api、panel、eval 读取的 sanitized product
  projection truth。旧 PG lease worker loop / recovery loop 不再参与 online
  serving。
- 当前 `ChatAnswerWorkflow` 已投影首条 chat trajectory，但粒度仍是
  `planning`、`semantic.rag`、`finalization`；目标 RAG durable graph 需要继续拆成
  retrieval / selection / synthesis / grounding 等可计量、可取消、可诊断 step。
- 进程内 lifecycle registry、active count 与 bounded queue 只保留为本进程
  runtime protection；它们不再是 durable execution truth，也不得被多实例叠加
  解释为全局 scheduler。当前缺口是 step-level durable ledger 完整落地、lane
  activity worker pool、worker autoscaler、step trajectory 诊断，以及 RAG
  typed retrieval/domain tools 与 durable step graph 的完整收口。
- 拥有 deterministic structured planner；当前实现位于
  `apps/execution-control/internal/structuredplanning`，`internal/execution`
  仅负责把 planner 输出适配成 bridge v6 `runtime_decisions`
- `runtime_decisions.workflow_plan` 已作为 planner 的 canonical safe projection
  落入 bridge contract；当前 runtime 默认只发出 `single_step` plan。受控
  开启 `EXECUTION_CONTROL_MULTI_STEP_WORKFLOW_ENABLED=true` 且 workflow run
  store ready 后，可执行首条真实 `multi_step` path：selected notice context +
  knowledge follow-through 触发 notice-agent internal selected notice resolve
  (`payload_kind=campus_notice_get`) -> `rag-agent retrieval.query`，并将 notice
  step 输出以 bounded internal workflow context projection 传给 RAG step。该 path 现已
  改为 planner 输出 internal `CapabilityPlan`，再由 artifact-registry resolver 编译
  `WorkflowPlan`；planner 不再手写 notice -> rag 固定 step shell。Go finalizer 同时在
  `workflow_trace_summary` 中记录 `answer_artifact_projection_ids` 与
  `answer_artifact_kinds`，用于证明最终答复使用了哪些 bounded artifact
- 拥有 deterministic runtime policy；当前实现位于
  `apps/execution-control/internal/runtimepolicy`，负责 product scope gate、
  approval / reject gate、context follow-up preflight、query-enabled scope
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
- 拥有 private bridge `AgentResponse -> SupervisorResponse` finalization 与
  response-level observability projection
- 对已打开的 deterministic structured payload，只有 ToolSpec
  `runtime_posture=typed_handoff_only` 的 payload 才允许作为 Go-owned typed
  activity 执行并写入 sanitized projection；
  `runtime_posture=sdk_adapter_admitted` 的 payload 进入 Go-owned
  `single_step` plan，再由 Python worker 的 Agents SDK native substrate 执行
- 通过 private bridge 调用 Python `apps/supervisor-agent-worker`
- 不拥有 product-layer auth/session/conversation、browser-facing capability
  policy 或 agent semantic reasoning

### `apps/supervisor-agent-worker`

- Docker-first internal execution service 的 Python orchestration worker
- 当前仍在 online answer hot path 中承接 private semantic bridge、provider client binding
  与 RAG / domain agent delegate dispatch；这是 current implementation fact，也是一项需要退出的
  long-term runtime gap
- 只接收 Go `execution-control` 已投影的 private bridge v6 delegate request
- 装配默认 agent delegate map，并通过 worker 内部 `AgentDispatcher` 调用 agent
- 只返回 `AgentResponse` 给 Go bridge；不再组装 public `SupervisorResponse`
- 不再暴露 public answer ingress；execution transport、admission、queue、metrics 与
  published `transport_runtime` 由 `apps/execution-control` 拥有
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
- 当前 cancel 只保证 bridge / agent checkpoints 可以观测取消；当 provider request 已进入阻塞
  HTTP / SDK 调用后，仍不能证明已 hard-abort 下游 token 消耗。长期 provider adapter 必须提供
  request id capture、abort、usage extraction 与 sanitized cost projection。
- 拥有 worker-side retrieval runtime observation bridge，把
  `retrieval.runtime_observation` 投影成 sanitized runtime event sink；不把 raw
  query / snippet / document body 写入 telemetry

### `apps/ingestion-worker`

- offline ingestion/data-plane executor
- 承接 source-truth / projection / chunk / index write path
- 拥有 official-web release task runtime；从 ingestion-owned task payload 推进
  selected-write / stable-reference release，不通过 app-api executor route 回写状态
- 拥有 ingestion run-level telemetry adapter，输出 canonicalize / chunk / embedding /
  index release / publish / audit 的 sanitized started/completed/failed run event；
  export failure 不让 ingestion job 失败

### `apps/official-web-collector`

- official web collector runtime
- 上报 crawl run lifecycle 与 artifact refs
- 不拥有 operator ledger、request projection 或 ingestion truth

## 当前 Package 边界

- `packages/rag-agent` 当前默认 knowledge agent，负责 retrieval-specific
  planning、clarification、grounded answer synthesis
- `packages/navigation-agent` 是 navigation semantic specialist package；产品主路径对
  `place_lookup` 仍保持 fail-close，直到地图产品正式上线。deterministic place / point
  reads 必须先表现为 typed tool 或 internal query service；navigation specialist 只能作为
  typed `agent_step` / agent-as-tool 消费这些工具，不拥有 spatial source truth
- `packages/campus-services-agent` 是 campus services semantic specialist package；当前
  capability family 覆盖 `service_status_lookup`、`service_guide_lookup`、
  `transport_schedule_lookup`、`contact_directory_lookup` 与
  `academic_calendar_lookup`。这些能力的 deterministic data access 默认是 typed tool /
  projection-backed internal query service；semantic specialist 只能在 typed
  `agent_step` / agent-as-tool 内消费工具输出。其中 `academic_calendar_lookup` 只消费
  `calendar/academic_calendar` projection-backed read model，支持教学周、命名校历事件区间、
  学期窗口与补课/调休上课事实，不负责校历查看入口说明
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
  这些 label 表示 semantic specialist family，不表示 deterministic source truth owner；
  notice / services / navigation 的默认实现入口必须是 typed tool 或 projection-backed
  internal query service，只有需要语义判断、消歧、摘要或跨工具编排时才进入 agent-as-tool。
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
