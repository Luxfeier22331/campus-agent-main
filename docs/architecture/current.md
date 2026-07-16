---
doc_type: architecture
truth_scope: repository
owner_boundary: docs/architecture
status: active
created: 2026-04-02
updated: 2026-07-15
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
workflow-worker / activity-worker-core / activity-worker-agent ->
Memory Recall -> one Agent Activity running the complete OpenAI Agents SDK
primary/Knowledge Agent loop -> Finalization -> Memory Append -> sanitized
projection`

`browser -> campus-web /docs/* -> Rspress-powered canonical reader`

`browser -> operator-console-web explicit allowlist proxy -> app-api -> request
projection / operator read model / operator-safe operations domains`

`digest-pinned source request -> ingestion-control v3 admission -> Temporal ->
source-collector or Rust-kernel activity -> object-store result manifest ->
bounded ingestion task projection`

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
  Temporal start/cancel/query seam、memory activities、internal query admission、
  evidence/source validation 与 sanitized projection writeback
- Docker Compose execution runtime 只保留 local diagnostics；长期 production
  target substrate 已由 ADR-0078 与 Kubernetes execution runtime architecture
  固定为 Temporal Worker Controller + KEDA。应用仓只保留 namespace-neutral
  Kustomize base；
  真实 Application、overlay、Helm values 与 encrypted secret inventory 由
  deployment environment repository 管理。live staging/production substrate
  不能只由本文文档措辞推断，必须看 environment revision、Argo/K8s status、runtime
  readiness、operator projection 与 release closeout artifacts。
- Temporal-backed chat execution path 已进入当前代码事实：`apps/app-api` 通过
  `/internal/execution/runs*` 调用 `apps/execution-control`，`apps/execution-control`
  启动 / 取消 `ToolExecutionWorkflow`，Temporal task queue 承担 execution substrate
- PG 不再是 online execution queue truth；`runtime.agent_runs`、run events 与 step
  tables 是 app-api / Operator Console / eval 消费的 sanitized run projection store
- 当前在线主问答路径固定为四阶段：`Memory Recall -> Agent Activity ->
  Finalization -> Memory Append`。`activity-worker-agent` 在单个 Agent Activity
  中调用 `apps/agent-runtime`，一次 OpenAI Agents SDK run 完成 primary agent、
  official `handoff()`、Knowledge Agent 与 SDK function tool loop。Go
  `execution-control` 保留 durable envelope、Temporal timeout/cancel、memory
  projection refs、runtime admission、sanitized projection 与 finalization ownership。
- 当前 ordinary chat 缺失 explicit tool hint 时保持 primary-agent-first：
  public app-api body 只接受 `conversationId?` 与 `prompt`，Go
  `execution-control` 根据 runtime registry 生成 admitted visible tool set 并交给
  `agent.primary` 决策。neutral memory recall 使用 `any` tool filter，
  direct/no-tool finalization 归因到 `primary_agent`。
- 当前代码事实中，`knowledge_query` 是 model-visible SDK handoff。Primary
  agent 选择它后通过官方 `handoff()` 进入同一 SDK run 内的 Knowledge Agent；
  Knowledge Agent 只可调用 internal-only `knowledge_search`。`knowledge_search`
  由 execution-control 注入 query-serving targets，并执行 target/access admission、
  embedding、Qdrant dense/sparse RRF lookup 与 bounded evidence projection。
- Temporal 不把 SDK handoff、function-tool call 或 Knowledge Agent 执行展开为
  额外 activity/queue。`execution-control` 的 `agent_runtime` 配置统一提供 SDK run
  deadline、`maxTurns`、output token、knowledge search 与字符预算；这些限制不改变
  四阶段 workflow。
- `final_model_context.v2` 只承载历史轮次、session state、上一轮 evidence/tool
  摘要与 bounded memory。它们以 SDK input items 进入模型，当前用户消息只作为最后
  一个 user item 出现一次；动态上下文不拼入 developer instructions。
- 当前 online memory recall 由 `MemoryRecallActivity` 执行，使用 Hindsight self-host runtime；
  app-api chat submit 不再读取 PG `profile.memory_items` 并全量注入
  `context.profile_memory`。Qdrant 只承载 institutional RAG。
- Step attempt evidence spine 已进入当前代码事实：`runtime.agent_step_attempts`、
  execution-control `/steps`、app-api operator summary 与 Operator Console
  trajectory 已承载 activity metadata、queue wait、duration、provider/model、
  token usage、cancel/timeout outcome 字段。模型成本由 Langfuse 根据 model 与
  usage 计算，不在 PostgreSQL projection 维护自研估算字段。`provider_execution_summary_v1` 与
  activity timeout / context cancel 可以投影为 first-class
  `activity_timeout` / `activity_context_canceled` outcome。
- 当前 `knowledge_search` 由 Go Qdrant native adapter 执行，Qdrant 仍是
  self-hosted authenticated private data-plane；embedding provider 调用使用 Go
  cancellable HTTP context。语义答案与 evidence-backed structured output 由
  Knowledge Agent 生成。
- 当前 cancel / timeout / late-completion 证据由 Temporal activity context、Go
  lookup/provider adapter、user cancel projection closeout 和 sanitized step attempt
  projection 承接；repo-local projection path 已能记录
  `activity_context_canceled`、`requested_before_start`、
  `provider_connection_aborted`、provider timeout 与 late completion ignored。
- Python `apps/supervisor-agent-worker` 不属于当前 serving workspace，不得作为
  readiness dependency、online fallback 或 active workflow branch 恢复。
- model-visible 与 internal tools 都只在 OpenAI Agents SDK tool loop 内执行；
  internal query 仍由 owning service fail closed，不走 Python serving shortcut。
- online query path 与 offline data plane 持续分层
- `apps/app-api` 不拥有 source collector command、run ledger 或 official-web
  lifecycle。ingestion-control 负责 v3 admission、Temporal workflow start 与 bounded
  projection；source-collector 只作为 Temporal Activity Worker 采集并写 object-store
  artifacts
- `jobs/*` 只承载一次性或定时 deployable runtime；不得把长驻 product backend、
  browser surface、shared package 逻辑或 online request handler 塞进 job
- `apps/ingestion-control` 是 self-hosted internal ingestion control-plane package，不是
  Cloudflare Worker。HTTP control-plane surface 与 Temporal workflow/activity
  worker 是不同 runtime role，不得藏进 `apps/app-api` 或 collector 进程。
- `wechat_official_account` 已进入 offline source capture：当前有 source-truth artifact
  和 Temporal source-collector task，但没有 app-api collector principal/run ledger，
  也不是 query-enabled surface
- 当前 public product endpoint 固定为 `https://campus.muc.wiki`；staging browser endpoint
  固定为 `https://campus-staging.mucwiki-edge.link`。

## 当前 Serving Surface

`configs/runtime/query-serving-targets.v1.json` 当前开放三个 Knowledge Agent
target：

- `student_rules` -> collection `student_rules` ->
  `regulations/student_rules/serving-config.json`
- `institutional_rules` -> collection `institutional_rules` ->
  `regulations/institutional_rules/serving-config.json`
- `curriculum` -> collection `curriculum_plan` ->
  `curriculum/curriculum_plan/serving-config.json`

The registry does not repeat `corpus`; corpus remains offline/serving metadata.
Execution-control validates that each registry collection matches its serving
config before query execution.

其他 serving config、data-plane collection 或 source channel 不会因为存在而自动成为
online target。`official_web` 尚未完成 canonical document、chunk、index 与 alias publish
链路，因此没有 query-serving target，也没有 live web-search fallback。其边界以
`docs/architecture/domains/official-web/architecture.md` 为准。

`campus_services/transport_schedule` 通过独立 model-visible structured tool 消费 typed
read model，不属于 generic knowledge retrieval。`calendar/academic_calendar` 仍是
offline-preparation 数据资产。

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
  `/operations/provider-config` 模型服务配置
- 通过 Worker `APP_API` Service Binding 消费 `apps/app-api` runtime-owned request /
  runtime health / provider configuration routes
- 当前不承载 Official Web、authenticated notice processing、dining operations、Quality、
  Safety、Cost、standalone Audit 或离线 Eval 页面
- 当前不 proxy `/api/official-web/*`、`/api/authenticated-notices/*`、
  `/api/ops/dining/*` 或 generic `/api/*`
- 不拥有 dining truth、auth/session truth 或第二套 operator backend
- `apps/app-api` 已有 `campus-services` operator routes，但当前 `operator-console-web`
  不承载校园服务校对与发布 workspace
- 它是唯一当前 Operator Console implementation package，不定义第二个长期后台产品概念

### `apps/ops-web`

- 已有自托管、默认只读的运行排查源码，Hono 服务端同时提供 React 页面和固定 `/api/ops/*`
- 读取 `chat.turn_dispatches`、`chat.messages`、`runtime.agent_runs` 和
  `runtime.request_observability_fact` 的受限列，以及固定服务健康检查和 OpenObserve，不经过
  `app-api`
- 使用 Access JWT、两级操作者白名单、列级数据库权限和原始观测读取审计
- 人员操作者可通过固定接口替换 `source-collector-internal-portal-auth/sso_tgc`；Kubernetes
  RBAC 仅允许该 Secret 的 `get`、`patch`，服务令牌和通用 Secret 操作均被拒绝
- Temporal 每 30 分钟强制用挂载 TGC 建立新门户会话并探测通知接口；确认凭据失效时固定
  Schedule 自动暂停，Ops Web 展示最近结果与观测有效区间，并允许人员恢复该 Schedule
- 当前浏览器 serving truth 仍是 `operator-console-web`；Ops Web 源码和 K8s base 不证明
  staging 已部署，也不替换现有 Worker Console

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
- 只通过 ingestion-control integration 读取 bounded ingestion task projection；不拥有
  official-web、authenticated-notice 或 WeChat collector command/ledger/schema
- 当前代码侧以 route exposure inventory 固定每个 route 的 caller class 与 admission rule

### `apps/execution-control`

- self-hosted internal execution ingress
- 暴露 `GET /healthz`、`GET /readyz`、`GET /metrics` 与
  `POST /internal/execution/runs`、`GET /internal/execution/runs/:runId`、
  `GET /internal/execution/runs/:runId/events`、
  `GET /internal/execution/runs/:runId/steps`、
  `POST /internal/execution/runs/:runId/cancel`
- 拥有 request body limit、caller auth、strict env parsing、run projection、
  Temporal workflow command/cancel、memory activities、internal query admission、
  evidence/source validation、sanitized projection writeback、timeout、readiness、
  metrics、OTel telemetry seam 与 graceful drain
- 当前 execution plane 已切为 self-hosted Temporal：`app-api` accepted chat
  request 调用 `execution-control` 创建 Temporal-backed run，Temporal
  workflow/activity worker 负责执行编排，PG `runtime.agent_runs` / events /
  step projection rows 只作为 Ops Web、受控 eval 读取的 sanitized product
  projection truth。
- 当前 `ToolExecutionWorkflow` 只有四阶段：`Memory Recall -> Agent Activity ->
  Finalization -> Memory Append`。Agent Activity 内的一次 OpenAI Agents SDK run
  拥有全部 agent/tool loop；无工具请求直接形成 terminal output，知识请求由
  primary agent 通过官方 `handoff()` 进入 Knowledge Agent。
- `knowledge_query` 是 model-visible handoff，`knowledge_search` 是 Knowledge
  Agent 唯一可调用的 internal-only tool。Raw retrieval endpoint、collection、top-k
  与 provider-specific tool 均不对 primary agent 或 browser 暴露。
  runtime catalog 的 tool payload/result schema ref 只允许指向已登记 JSON
  Schema `$id#/$defs/...`；active runtime 不再维护 Python contract mirror。
  当前 runtime-supported tools 通过 `tools.v5`、`tool-function-schemas.v2` 与
  `workflow-artifacts.v2` 暴露给 `agent.primary`，并由 execution-control internal
  query endpoint 执行；Go runtime 通过 tool registry / function schema / endpoint
  drift test 约束可调用性。存在 ToolSpec 或 contract 不等于 model-visible；
  runtime config 不再承担独立工具 allowlist，只配置依赖、预算与观测。
  每个主干 step 写入
  `RunStep -> StepAttempt -> StepResult` projection。attempt projection 已包含
  Temporal activity metadata、queue wait、duration、provider/model、token usage、
  cancel/timeout outcome 字段；Langfuse 承担模型成本计算与分析。
- 当前 public durable chat path 已具备 primary-agent-first metadata、primary agent
  direct/no-tool terminal branch、model-selected `knowledge_query` handoff
  和 agent-result finalization。`campus_services` 已有 internal-query 基底；
  只有 runtime tool registry 中
  model-visible 且拥有严格 function schema 的工具会进入 primary agent 可见工具集。
  `navigation` 仍默认 closed，必须 fail closed。当前 model-visible surfaces
  是 function tool `transport_schedule_lookup` 与 official handoff target
  `knowledge_query`；
  generic service status、service guide、contact directory、notice product
  tools 与 academic calendar 不属于当前打开工具面。
- 进程内 lifecycle registry、active count 与 bounded queue 只保留为本进程
  runtime protection；它们不再是 durable execution truth，也不得被多实例叠加
  解释为全局 scheduler。
- 当前 ordinary chat first decision、handoff 与 function tool execution 都由同一
  OpenAI Agents SDK run 完成。workflow trace / projection 只记录 bounded result
  refs、step metadata 与 safe
  summaries，不携带 raw projection payload。execution payload 只承载 request facts
  与可选 trusted hint，不承载第二套 planner decision object。
- 拥有 runtime tool registry 与 query-serving target registry admission；
  当前实现位于 `apps/execution-control/internal/runtimepolicy`，缺失、版本漂移或
  未发布 target 必须 fail closed。工具选择由 primary-agent tool loop 完成，不存在
  平行 intent policy 或 classifier。
- finalization 校验 terminal output、已投影 evidence refs 与 source identity，生成
  browser-safe sources 后写入终态；它不调用模型，也不改写 answer text
- `app-api` 从 sanitized projection / run events closeout，原样持久化并流式返回
  finalized answer 与 sources，不执行第二次答案改写
- 拥有 online runtime OTel trace owner 责任：`execution-control` 接收 trace context，
  发出 sanitized OTLP trace signal 到 Collector seam，并在 Collector/exporter 不可用时保持
  answer path fail-safe
- 拥有 execution-control finalization validation 与 response-level observability
  projection
- worker pool 只包含 workflow、core 与 agent；不存在按 tool、knowledge 或
  specialist 拆分的 Temporal worker/queue
- 不拥有 product-layer auth/session/conversation 或 agent semantic reasoning

### `apps/ingestion-control`

- internal ingestion/data-plane task control plane
- 拥有 v3 task admission、registry snapshot、Temporal workflow start、control/Rust
  activities、terminal projection 与 official-web URL freshness
- HTTP server 是 control-plane surface；Temporal workflow / activity workers 是
  独立 self-hosted runtime processes，不是 Cloudflare Worker。
- active executor 仅 `source_collector` 与 `rust_kernel`；未注册实现或 contract
  mismatch 时 fail closed，不回退 Python collection CLI
- PostgreSQL 只保存 bounded task projection 与 latest URL freshness；Temporal 和
  object storage 分别拥有 workflow truth 与 artifact truth

### `apps/source-collector`

- TS-owned source-channel collector runtime
- 当前承载 `internal-portal`、`official-web` 与 `wechat-official-account` adapters
- 作为 Temporal Activity Worker 消费四个 `source_collector` registry tasks，负责
  source capture、source-bucket artifacts 与一个 digest-pinned result manifest
- 不暴露 HTTP control plane，不调用 app-api，不拥有 run ledger、workflow start 或
  terminal PostgreSQL projection
- adapter 内部可使用 Crawlee 承接 crawl queue / retry / concurrency；Crawlee request
  identity 不替代 source-bucket handoff contract
- 具备独立 Temporal worker Docker image，并通过 ingestion-runtime WorkerDeployment
  部署；不得混入 online execution worker plane

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
- 可作为 local manual command、Docker manual command、Kubernetes Job 或 CronJob 运行
- 不属于 `apps/app-api` 在线请求路径，不提供 browser route，不承载 Operator Console
  控制面，不公开 raw Feishu/Lark row、file token 或临时下载 URL

## 当前 Package / Runtime 边界

- `apps/agent-runtime` 当前拥有唯一 OpenAI Agents SDK agent/tool loop；primary
  agent 与 Knowledge Agent 在同一次 SDK run 内通过 official handoff 连接
- `apps/execution-control` 当前拥有 Temporal durable envelope、target/access
  admission、`knowledge_search` retrieval、bounded evidence/source validation 与
  fail-close finalization projection
- 当前没有 model-visible place tool 或 execution contract。place catalog 仅由
  campus-map read surface 消费；未来 place finding 必须建立新的 TS/Go runtime、
  ToolSpec 与 browser projection contract
- `campus_services` 当前由 `apps/execution-control` 拥有 Go tool read model runtime。
  model-visible tool 只有 `transport_schedule_lookup`。generic service status、
  service guide、contact directory、process guide 与 academic calendar 不属于当前
  campus-services runtime surface。
- repo-owned internal `knowledge_search` seam 负责 access filter、embedding、
  Qdrant dense/sparse RRF lookup 与 bounded evidence shaping
- `apps/ingestion-control` ingestion task control plane and Temporal worker
  runtime；TS `packages/ingest-core` 提供 runtime-neutral ingestion helpers；
  未来 OCR / file extraction 需重新 admission 为 explicit adapter boundary
- `packages/contracts` execution wire、tool payload/result 与 runtime artifact
  shared schema seam

## 当前术语真相

- Model-visible agent surfaces are SDK function tools and official handoffs.
- The current set is function tool `transport_schedule_lookup` and handoff
  target `knowledge_query`.
- `knowledge_query` is selected by `agent.primary` through the OpenAI Agents SDK
  `handoff()` API. It is not a function tool or agent-as-tool wrapper.
  `knowledge_search` is internal-only and visible only to the Knowledge Agent.
- `knowledge`, `campus_services`, `notice` and `navigation` may still appear as
  runtime labels, package names or projection labels. They do not name worker
  pools, task queues or a second semantic routing layer.
- `requested_tool` and `selected_tool` are current wire/projection fields.
  New active runtime descriptions should distinguish SDK handoff, function-tool
  call and selected tool unless referring to the exact field or file name.
- Serving expansion is opened only by adding concrete ToolSpec entries,
  model-visible registry/schema entries, contracts, internal query owners and
  eval denominators. Product routing vocabulary remains concrete tool id only.

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
