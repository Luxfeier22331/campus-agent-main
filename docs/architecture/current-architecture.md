---
doc_type: architecture
status: active
created: 2026-04-02
updated: 2026-04-27
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

`browser -> public-chat-web -> app-api -> supervisor-api -> supervisor-agent-worker
private bridge -> agent`

`browser -> public-docs static reader assets`

`browser -> public-docs same-site /api/docs/* -> app-api docs control plane`

`browser -> protected-panel-web -> app-api -> request projection / operator read
model`

`collector -> app-api official_web control plane -> ingestion-worker`

关键约束：

- browser 不直打 `apps/supervisor-api`
- panel 不绕过 `apps/app-api`
- public chat / docs / panel 到 `apps/app-api` 的 Worker-to-Worker 调用走 `APP_API`
  Service Binding；`https://app-api.internal` 是内部 Request construction origin
- `apps/app-api` 是唯一 product-layer auth/session/principal owner
- `campus-api-staging.ayafeed.com` 如存在，只表示 app-api staging machine / ops
  ingress，不是 browser surface upstream
- `apps/supervisor-api` 是 Go-owned internal execution engine，不是产品后端
- `apps/supervisor-api` 的部署 substrate 已冻结为 Docker-first internal execution service
- `apps/supervisor-api` 是当前 Docker execution ingress，负责 execution HTTP surface
  与 runtime hardening；Python `apps/supervisor-agent-worker` 只保留 private bridge worker
- semantic delegate path 仍进入 Python private bridge；已打开的 deterministic
  structured capability 可以在 Go `apps/supervisor-api` 的 non-stream answer path 与
  lifecycle SSE answer path 直接完成
- Python bridge 返回 private `AgentResponse`；public `SupervisorResponse`
  finalization 与 response observability projection 由 Go `apps/supervisor-api` 执行
- online query path 与 offline data plane 持续分层
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
- `campus_services/*` 当前仍保持 `offline_preparation`

当前非 serving capture-only scope：

- `campus_notices/file_release_capture` authenticated notice `file_release`
  local-PG-only inventory / raw-asset ledger；用于 owner-recovery readiness 与
  operator 排障，`query_enabled=false`，不生成 document / chunk / index / release

## 当前 App 边界

### `apps/public-chat-web`

- public-facing Worker web surface
- 正式拥有 public auth family route
  shell：`/login`、`/register`、`/forgot-password`、`/reset-password`
- 只负责 browser route shell 与 chat UI
- auth family 通过 same-site seam 将 Turnstile verification transport 到
  `apps/app-api`
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

### `apps/app-api`

- shared Worker-native application/control-plane backend
- 拥有 auth、session、principal mapping、conversation truth、request ledger /
  projection input 与 selected operator surfaces
- 拥有 public-docs same-site `/api/docs/*` 背后的 document reader control-plane truth
- 拥有 Better Auth email/password、password reset 与 Turnstile-backed auth admission
  hardening
- 承接 `official_web` control plane
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
  `SUPERVISOR_API_MULTI_STEP_WORKFLOW_ENABLED=true` 且 workflow run store ready 后，
  可执行首条真实 `multi_step` path：selected notice context + knowledge follow-through
  触发 `notice-agent campus_notice_get -> rag-agent retrieval.query`，并将 notice step
  输出以 bounded internal workflow context projection 传给 RAG step
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
- 拥有 private bridge `AgentResponse -> SupervisorResponse` finalization 与
  response-level observability projection
- 对已打开的 `campus_services` / `notice` deterministic structured payload，
  non-stream `/api/v1/answer` 与 lifecycle SSE `/api/v1/answer/stream` 可以直接执行
  Go structured runtime 并返回 supervisor-style response
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

### `apps/ingestion-worker`

- offline ingestion/data-plane executor
- 承接 source-truth / projection / chunk / index write path

### `apps/official-web-collector`

- official web collector runtime
- 上报 crawl run lifecycle 与 artifact refs
- 不拥有 operator ledger、request projection 或 ingestion truth

## 当前 Package 边界

- `packages/rag-agent` 当前默认 knowledge agent，负责 retrieval-specific
  planning、clarification、grounded answer synthesis
- `packages/navigation-agent` 已接受的 navigation capability boundary；当前 package /
  contract truth 存在，但产品主路径对 `place_lookup` 仍保持 fail-close，直到地图产品正式上线
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
