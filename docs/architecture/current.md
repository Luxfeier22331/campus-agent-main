---
doc_type: architecture
truth_scope: repository
owner_boundary: docs/architecture
status: active
created: 2026-04-02
updated: 2026-07-05
---
# 当前架构

## 文档边界

本文只负责描述 `campus-agent` 当前 accepted merged-truth architecture snapshot。

它回答的是：

- 当前前向产品拓扑是什么
- 当前哪些 serving surface 已开放
- 当前 `apps/*`、`jobs/*` 与 `packages/*` 的责任边界是什么
- 当前哪些文档负责目标架构与 supporting architecture

它不负责：

- 历史 phase 叙事
- 未合入分支实现进度
- active planning signal、ops closeout 或 release acceptance
- collection-specific cleanup / eval / rebuild 细节
- 长期产品顶层入口 IA 的前向规划

## 当前拓扑

当前接受的主拓扑固定为：

`browser -> campus-web -> student campus experience / account shell`

`campus-web same-origin allowlisted /api/* -> app-api`

`browser -> campus-web Q&A -> app-api durable chat lifecycle SSE
(/api/chat/requests/stream, /api/chat/runs/:runId/events/stream) ->
app-api chat conversation/run routes -> execution-control -> Temporal ->
workflow-worker / activity-worker-core / activity-worker-agent /
activity-worker-knowledge -> memory recall / typed
tool branch / Go RAG DTO/runtime -> Qdrant / provider / structured read
models -> sanitized projection`

`browser -> campus-web /docs/* -> Rspress-powered canonical reader`

`browser -> operator-console-web explicit allowlist proxy -> app-api -> request
projection / operator read model / operator-safe operations domains`

`collector -> ingestion-control official-web/source-channel control-plane ->
ingestion-control-api task admission`

`ingestion-control Temporal workflow/activity worker registry-aware execution
-> source truth / projection / document/index release`

`Feishu/Lark Base catalog tables -> jobs/dining-sync catalog-observations ->
dining.source_observations(source_type=feishu_catalog) ->
jobs/dining-sync publish-catalog / publish-catalog-from-observations ->
dining catalog/release tables ->
app-api /api/dining/* reader`

`Feishu/Lark Base review table -> jobs/dining-sync Job/CronJob -> current
catalog resolver -> content moderation -> dining.source_observations(source_type=feishu_review) ->
dining.review_projections -> app-api /api/dining/* reader`

关键约束：

- browser 不直打 `apps/execution-control`
- `campus-web` 是当前学生侧 product entry surface 与 account browser shell，不是第二个
  product backend、generic app-api proxy 或 MediaWiki proxy
- `campus-web` Q&A 当前使用 first-party assistant chat surface；浏览器不再加载
  ChatKit runtime，不再允许 `/vendor/openai-chatkit/*` 作为 Q&A 必需资源
- Operator Console 的当前 implementation surfaces 不绕过 `apps/app-api`
- `campus-web` 与 Operator Console surfaces 到 `apps/app-api` 的 Worker-to-Worker
  调用走 `APP_API` Service Binding；
  `https://app-api.internal` 是内部 Request construction origin
- `apps/app-api` 是唯一 product-layer auth/session/principal owner
- `apps/app-api` 当前是 neutral Identity Platform 的 canonical product owner；
  Better Auth 是 auth runtime adapter，不是产品账号、校园身份、access entitlement 或
  federation policy schema owner
- `api-staging.mucwiki-edge.link` 如存在，只表示 app-api staging machine / ops
  ingress，不是 browser surface upstream
- `apps/execution-control` 是 Go-owned internal execution engine，不是产品后端
- `apps/execution-control` 负责 internal workflow command/query、admission/policy gate、
  Temporal start/cancel/query seam、memory recall + RAG activity execution 与
  sanitized projection writeback
- Docker Compose execution runtime 只保留 local / transitional evidence；长期
  production target substrate 已由 ADR-0056 与 Kubernetes execution runtime
  architecture 收口为 K8s + KEDA。live staging/prod substrate 不能只由本文
  文档措辞推断，必须看 applied resources、runtime env、operator projection 与
  release closeout artifacts。
- Temporal-backed chat execution path 已进入当前代码事实：`apps/app-api` 通过
  `/internal/execution/runs*` 调用 `apps/execution-control`，`apps/execution-control`
  启动 / 取消 `ToolExecutionWorkflow`，Temporal task queue 承担 execution substrate
- PG 不再是 online execution queue truth；`runtime.agent_runs`、run events 与 step
  tables 是 app-api / Operator Console / eval 消费的 sanitized run projection store
- retired PG lease tables、execution-group budget、worker heartbeat、PG lease
  worker loop 与 recovery loop 只允许作为 historical migration artifact /
  retired code path 出现，不参与当前 online serving
- 当前在线主问答路径已进入 first Execution Agent decision / direct no-tool terminal
  branch：`ToolExecutionWorkflow` 执行
  `context.memory_recall -> agent.primary -> finalization.write`。
  `agent.primary` 由 `activity-worker-agent` 调用 `apps/agent-runtime`，后者使用
  OpenAI Agents SDK 承接模型-facing instructions、tool loop 与 direct/no-tool
  final output；Go `execution-control` 保留 durable envelope、Temporal timeout /
  cancel、memory projection refs、visible tool allowlist、sanitized
  `agent.primary` step projection 与 finalization ownership。
- 当前 ordinary chat 缺失 explicit tool hint 时保持 primary-agent-first：
  `app-api` 允许 `requestedTool=null`，Go `execution-control` 不再把缺失
  `requested_tool` 写成 `knowledge_query`，而是把 admitted visible tool set
  交给 `agent.primary` 决策。neutral memory recall 使用 `any` tool filter，
  direct/no-tool finalization 归因到 `primary_agent`。
- `plan.route -> tool branch` 不再是主问答链路的第一模型决策。它仍作为
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
  可以投影为 first-class `activity_timeout` / `activity_context_canceled` outcome。
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
- Python `apps/supervisor-agent-worker` 已从 active workspace 删除；旧 handoff/server
  code 只可通过 git history 追溯，不得作为 readiness dependency、online fallback 或
  active workflow branch 恢复。
- opened deterministic structured tool 必须作为 Go-owned typed Temporal
  activity 执行并写入 sanitized projection；未完成 worker contract 的 tool
  fail closed，不走 Python serving shortcut。
- online query path 与 offline data plane 持续分层
- `apps/app-api` 不拥有 official-web selected-write / release task state machine；
  Temporal workflow start、registry-aware activity dispatch、materialize、publish、
  terminal closeout 与失败状态属于 `apps/ingestion-control`
- `jobs/*` 只承载一次性或定时 deployable runtime；不得把长驻 product backend、
  browser surface、shared package 逻辑或 online request handler 塞进 job
- `apps/ingestion-control` 是 self-hosted internal ingestion control-plane package，不是
  Cloudflare Worker。HTTP control-plane surface 与 Temporal workflow/activity
  worker 是不同 runtime role，不得藏进 `apps/app-api` 或 collector 进程。
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
- `campus_services/transport_schedule` 当前保持 `tool_read_model_serving`：只通过
  admitted structured tool 消费 current projection/read model，不进入 generic retrieval
  默认 query scope
- `calendar/academic_calendar` 当前是 offline-preparation 数据资产；不作为
  campus-services runtime tool

当前非 serving capture-only scope：

- `authenticated_documents/file_release_source` authenticated notice
  `file_release` object-backed source holding；由 ingestion-control materialize 后供
  owner-specific downstream admission / operator 排障消费，`query_enabled=false`，不生成默认
  query-serving release

## 当前 App 边界

### `apps/campus-web`

- public-facing Worker web surface for `campus.muc.wiki`
- 拥有学生侧主体验、校园应用入口、conversation/map/dining/feedback shell 与
  `/account/*` account browser shell
- 拥有 `/docs/*` docs browser route；当前 docs browser surface 由
  Rspress-powered canonical reader 承担，不再依赖独立 `public-docs` product surface
- 通过 allowlisted same-origin seam 与 Worker `APP_API` Service Binding 调用
  `apps/app-api` 的 `/api/me/*`、必要 `/api/auth/*`、implemented `/api/federation/*`、
  docs/chat/map/dining/feedback endpoints；Q&A 主线程通过
  `/api/chat/requests/stream` 与 `/api/chat/runs/:runId/events/stream`
  接入 app-api durable chat lifecycle stream
- Q&A 主线程、composer 与会话历史 UI 由 `campus-web` 通过 assistant-ui
  primitives 承担；conversation/message/title truth、stream command 与历史读写仍属于
  `apps/app-api`
- account/auth UI 由 `better-auth-ui` 承接；通用控件使用 shadcn/Radix wrappers，
  表单状态与校验使用 `react-hook-form` + `zod`
- map / dining 只保留领域数据渲染、地图/楼层 adapter 与交互 glue；其通用按钮、
  弹层、切换、搜索输入等 primitive 不再自研
- 不开放 generic `/api/*` proxy；未知 browser path fail-closed
- 不代理、镜像、迁移或重新服务 MediaWiki 页面内容、上传媒体或账号
- 不拥有 auth/session/principal/identity/federation truth；canonical identity 仍属于
  `apps/app-api`

### `apps/operator-console-web`

- protected Worker web surface
- 负责 Operator Console 当前最小 UI：`/requests` 请求与运行值班台、
  `/operations/provider-config` 模型服务配置、`/operations/observability`
  观测配置
- 通过 Worker `APP_API` Service Binding 消费 `apps/app-api` runtime-owned request /
  runtime health / provider configuration / observability configuration routes
- 当前不承载 Official Web、authenticated notice processing、dining operations、Quality、
  Safety、Cost、standalone Audit 或离线 Eval 页面
- 当前不 proxy `/api/official-web/*`、`/api/authenticated-notices/*`、
  `/api/ops/dining/*` 或 generic `/api/*`
- 不拥有 dining truth、auth/session truth 或第二套 operator backend
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
- 对 `official_web`，只拥有 operator projection/query 与 stable-reference release gate
  approve/reject ledger；不拥有 collector command ingress、crawl-run ledger、
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
- 当前 `ToolExecutionWorkflow` 主干已切为 `context.memory_recall ->
  agent.primary -> finalization.write` 或 `context.memory_recall ->
  agent.primary -> knowledge RAG graph -> finalization.write`。`agent.primary`
  通过 OpenAI Agents SDK 暴露 model-visible read-only tool catalog，由模型在
  agent loop 内决定是否调用工具；无工具请求可直接产出 final output。knowledge
  请求只向模型暴露 `knowledge_query` workflow-signal tool，实际 RAG 仍进入
  Go-owned Temporal graph；`retrieval.query` 不作为 model-visible tool 暴露。
  runtime catalog 的 tool payload/result schema ref 只允许指向已登记 JSON
  Schema `$id#/$defs/...`；Python `campus_contracts.*` dataclass 只是
  language-local helper，不是 active runtime schema truth。
  当前 projection-backed 且 runtime-supported 的 campus-services / notice read-only
  tools 通过 `tools.v4` 与 runtime profile `open_tools` 暴露给
  `agent.primary`，并由 execution-control internal query endpoint 执行；Go runtime
  通过 tool registry / function schema / endpoint drift test 约束可调用性。存在
  ToolSpec 或 contract 不等于 model-visible，未被 profile 打开的工具必须保持
  closed。
  每个主干 step 写入
  `RunStep -> StepAttempt -> StepResult` projection。attempt projection 已包含
  Temporal activity metadata、queue wait、duration、provider/model、token/cost、
  cancel/timeout outcome 字段。
- 当前 public durable chat path 已具备 primary-agent-first metadata、primary agent
  direct/no-tool terminal branch 与 agent-result finalization。`campus_services`
  与 `notice` 已有 typed tool/internal-query 基底；只有 `tools.v4`
  中 model-visible 且被 runtime profile 打开的工具会进入 primary agent 可见工具集。
  `navigation` 仍默认 closed，必须 fail closed。`campus_services` 当前 model-visible 范围只包含
  `transport_schedule_lookup`；generic service status、service guide、contact
  directory 与 academic calendar 不属于当前打开工具面。
- 进程内 lifecycle registry、active count 与 bounded queue 只保留为本进程
  runtime protection；它们不再是 durable execution truth，也不得被多实例叠加
  解释为全局 scheduler。
- 旧 deterministic structured planner 已从 active runtime 删除。当前 ordinary chat
  first decision 由 `agent.primary` 在已裁剪的 visible tool set 内完成；RAG graph 与
  typed tools 保留各自内部 deterministic projection / validation support path。
- `ToolExecutionWorkflow` 的当前主干由 primary agent SDK loop 承接工具选择
  与 direct answer；当 primary agent 选择 `knowledge_query` 时，workflow 使用
  agent result projection ref 作为 plan/dependency input 进入 Go RAG graph。
  保留的 resolved branch plan 仍可执行：knowledge step 进入 Go RAG graph；
  `campus_services` / `notice` step 进入 typed tool activity；
  selected-notice follow-through 可由 resolver 编译为 typed tool step + knowledge
  step。workflow trace / projection 只记录 bounded result refs、step metadata 与 safe
  summaries，不携带 raw projection payload。旧 handoff v6 `runtime_decisions` 不再是
  current durable chat path 的规划输入。
- 拥有 deterministic runtime policy；当前实现位于
  `apps/execution-control/internal/runtimepolicy`，负责 product scope gate、
  readiness / reject gate、context follow-up preflight、query-enabled scope
  admission 与 tool policy version；intent signal taxonomy、reason
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
  activity contract、projection contract 与 task queue poller 的 tool 才允许
  serving；缺 worker/config/poller 时 fail closed
- 不拥有 product-layer auth/session/conversation、browser-facing tool
  policy 或 agent semantic reasoning

### `apps/ingestion-control`

- internal ingestion/data-plane task control plane
- 拥有 task admission、registry validation、Temporal workflow start、terminal
  closeout 与 operator-safe projection snapshot
- 拥有 `official_web` collector command ingress、crawl-run ledger、target workset
  resolution 与 source-truth materialization task admission
- HTTP server 是 control-plane surface；Temporal workflow / activity workers 是
  独立 self-hosted runtime processes，不是 Cloudflare Worker。
- registry-aware activity 按 `ts_control` / `rust_kernel` 分派任务；未注册 handler /
  kernel 时 fail closed，不回退 Python collection CLI
- Python app-level worker 已移除；Python 只允许作为 explicit library / service
  dependency 由 TS handler 调用，例如 MinerU / OCR / legacy Office / ML extraction
  adapter

### `apps/source-collector`

- TS-owned source-channel collector runtime
- 当前承载 `internal-portal`、`official-web` 与 `wechat-official-account` adapters
- 各 adapter 负责 source-channel capture、source-bucket artifact 写入与对应
  control-plane run lifecycle 上报；`official-web` 上报 `apps/ingestion-control`，
  `wechat-official-account` 仍上报 `apps/app-api`
- 不拥有 operator ledger、request projection、ingestion-control task lifecycle 或
  source-truth materialization truth
- adapter 内部可使用 Crawlee 承接 crawl queue / retry / concurrency；Crawlee request
  identity 不替代 source-bucket handoff contract
- 具备独立 Docker image entrypoint；不得作为 execution-runtime K8s workload 混入
  execution-control / Temporal worker plane

## 当前 Job 边界

### `jobs/dining-sync`

- dining data write runtime
- 通过 Feishu/Lark OpenAPI 读取已授权 Base catalog 记录，写入
  `dining.source_observations(source_type=feishu_catalog)`，并发布 catalog/release
  snapshot
- 可从 `packages/domains/dining` 导入 repo-owned bootstrap/dev catalog fixture；
  fixture 不是生产 catalog source truth
- 通过 Feishu/Lark OpenAPI 读取已授权 Base 评价记录
- 校验记录形状，通过 Gitee AI moderation endpoint 审核评价文本和图片；图片先进入对象存储
  moderation 前缀，审核通过后才物化到公开 review 前缀
- 写入 dining catalog/release tables、
  `dining.source_observations(source_type=feishu_catalog|feishu_review)` 与
  `dining.review_projections`
- 可作为 local one-shot、Docker one-shot、Kubernetes Job 或 CronJob 运行
- 不属于 `apps/app-api` 在线请求路径，不提供 browser route，不承载 Operator Console
  控制面，不公开 raw Feishu/Lark row、file token 或临时下载 URL

## 当前 Package / Runtime 边界

- `apps/execution-control` 当前拥有 Go-owned knowledge / RAG Temporal activity graph，
  负责 retrieval-specific planning、evidence selection、grounded synthesis 与
  fail-close finalization runtime
- `packages/navigation-tool` 是 navigation semantic specialist package；
  产品主路径对 `place_lookup` 仍保持 fail-close，直到地图产品正式上线。
  deterministic place / point reads 必须先表现为 typed tool 或 internal query
  service；navigation specialist 只能作为 typed `agent_step` / agent-as-tool
  消费这些工具，不拥有 spatial source truth
- `campus_services` 当前由 `apps/execution-control` 拥有 Go tool read model runtime。
  model-visible opened tool 只有 `transport_schedule_lookup`。generic service status、
  service guide、contact directory、process guide 与 academic calendar 不属于当前
  campus-services runtime surface。
- repo-owned internal retrieval seam / Go RAG runtime 负责 retrieval abstraction、
  metadata pre-filter、evidence shaping；旧 Python `packages/retrieval-core` 已不属于
  active workspace
- `apps/ingestion-control` ingestion task control plane and Temporal worker
  runtime；TS `packages/ingest-core` 提供 runtime-neutral ingestion helpers；
  旧 Python ingestion package 已删除，未来 OCR / file extraction 需重新 admission 为
  explicit adapter boundary
- `packages/contracts` tool handoff 与 shared typed seam

## 当前术语真相

- Active product/routing concept is `tool`.
- Model-visible opened tools are concrete tool ids such as
  `knowledge_query`, `transport_schedule_lookup` and `campus_notice_discover`.
- `knowledge`, `campus_services`, `notice` and `navigation` may still appear as
  runtime labels, package names, queue names, projection labels or semantic
  specialist labels. They are not product-level tool abstractions and do
  not replace concrete ToolSpec entries.
- `ToolRequest` / `ToolResponse`, `requested_tool` and
  `selected_tool` are current wire/projection fields.
  New active runtime descriptions should say tool handoff, tool dispatch and
  selected tool unless referring to the exact field or file name.
- Serving expansion is opened only by adding concrete ToolSpec entries,
  runtime profile `open_tools`, contracts, workers/read models and eval
  denominators. Product routing vocabulary remains concrete tool id only.

## 当前文档地图

- 产品定位：`docs/architecture/product.md`
- 当前架构：本文
- 目标架构：`docs/architecture/target.md`
- 产品/runtime supporting
  architecture：`docs/architecture/system/product-runtime.md`
- Execution Agent Layer supporting
  architecture：`docs/architecture/system/execution-agent-layer.md`
- prompt/instruction supporting
  architecture：`docs/architecture/system/prompt.md`
- account / operator access / memory binding supporting
  architecture：`docs/architecture/system/identity-authz.md`
- identity platform supporting
  architecture：`docs/architecture/system/identity-platform.md`
- identity browser experience supporting
  architecture：`docs/architecture/system/identity-browser.md`
- muc.wiki federation supporting
  architecture：`docs/architecture/system/mucwiki-login.md`
- retrieval / serving supporting
  architecture：`docs/architecture/system/retrieval-serving.md`
- data plane supporting
  architecture：`docs/architecture/system/data-plane.md`
- shared file asset supporting
  architecture：`docs/architecture/system/file-asset-loader.md`
- campus services tool read model runtime supporting
  architecture：`docs/architecture/domains/campus-services/architecture.md`
- `official_web` supporting
  architecture：`docs/architecture/domains/official-web/architecture.md`
- authenticated notice source supporting
  architecture：`docs/architecture/domains/authenticated-notice/architecture.md`
- operator observability supporting
  architecture：`docs/architecture/system/ops-observability.md`
- active planning signals：`.planning/PROJECT.md`、
  `.planning/WORKSTREAMS.md`

## 不在本文维护的真相

以下内容不在本文维护：

- 最新 benchmark artifact、release gate 结果、当前工作焦点
- 历史 phase 排期与执行叙事
- collection-specific normalization / rebuild / eval 证据
- active planning signal、ops closeout 与 release acceptance

这些分别以 `.planning/`、`docs/runbooks/`、`docs/reference/` 为准。
