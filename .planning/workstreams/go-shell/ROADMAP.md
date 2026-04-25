---
doc_type: roadmap
status: active
created: 2026-04-23
updated: 2026-04-25
---

# Roadmap: go-shell

## Current Progress

- `Phase 0-54` repo-local implementation 已完成。
- 当前 `Phase 8-9` 已补齐 Go -> Python cooperative cancel signal 与 Go
  structured query runtime foundation。
- `Phase 10` 已补齐 `transport_schedule_lookup` projection-backed runtime
  kernel 与 Python thin-adapter wiring；产品主路由 gate 仍保持关闭，后续 opening
  需要 release-gate regression / eval evidence。
- `Phase 11` 已补齐 forward capability label / lane alignment：`campus_services`
  与 `notice` 可作为显式 internal execution capability 进入对应 Go admission lane
  和 specialist-owned structured runtime handoff；knowledge path gate-closed 行为不变。
- `Phase 12` 已将 `campus_notice_discover` / `campus_notice_get` 的确定性
  read-model query runtime 迁到 Go `apps/supervisor-api`：Go 读取 PG read model 与
  S3-compatible derived canonical body，Python `notice-agent` 保留 HTTP thin
  adapter，产品主路由 gate 仍保持关闭。
- `Phase 13-15` 已补齐 cancellation checkpoint、bridge circuit breaker 与 runtime
  accounting：Go 能把 bridge cancellation terminal response 记为 `canceled`，Python
  default orchestration 会在 deterministic checkpoints 观测 cancel，bridge transport /
  protocol failure 有 circuit breaker，audit failure/cancel events 携带 measured bridge
  duration 与 queue wait summary。
- `Phase 16-19` 已补齐 service-status 当前性 fail-close、execution audit
  batching/retry/spool、OTel sample/export/drop/failure accounting，以及
  `/api/v1/answer/stream` lifecycle SSE seam；`app-api` 已具备 optional stream
  adapter。
- `Phase 20` 已补齐 Go effective capability/lane inference、structured runtime
  opening gate、capability gate readiness/metrics，以及 Python bridge 本地 audit
  writer 清理；`campus_services` / `notice` 仍默认 gate closed。
- `Phase 27` 已把 Go preplanned handoff 从 structured-only 扩展到 knowledge
  delegate path，Python bridge / `packages/supervisor-core` 主路径不再 fallback 构造
  routing 或 specialist request payload。
- `Phase 28-30` 已把 non-delegate terminal envelope、structured tool policy
  summary 与 current nested runtime decision envelope 收口到 Go
  `supervisor-api`，Python bridge 对缺失 Go-owned handoff / terminal envelope 的请求
  fail-closed。
- `Phase 31` 已为 opened `campus_services` / `notice` structured capability 增加
  `/api/v1/answer` direct structured runtime path；deterministic structured payload
  不再必须经过 Python bridge。
- `Phase 32-33` 已把 selected target / tool、terminal outcome 与 fail-close reason
  纳入 metrics / OTel / execution audit 的低基数 runtime decision summary，并补齐
  docs 与 guardrails。
- `Phase 34-38` 已将 bridge 升级为 v4 full `SpecialistRequest` handoff，删除 Python
  framing helper、Python bridge runtime audit emission 与 production supervisor terminal
  prompt stack，并让 lifecycle SSE structured direct path 与 docs / guardrails 完成收口。
- `Phase 39-45` 已让 Go non-stream / lifecycle SSE answer path 直接执行
  non-delegate terminal envelope，Python bridge hardcut 为 delegate-only v4 handoff，
  `packages/supervisor-core` public handler 只接受 Go preplanned `SpecialistRequest`；
  production core 不再导入 `RoutingDecision`、`finalize_routing_decision` 或 runtime
  audit sink。
- `Phase 46-48` 已删除 Python worker stale audit seam、supervisor-core `audit.py`
  与 legacy `routing.py`，intent eval 默认且唯一使用 Go `supervisor-api`
  runtime-policy runner；guard 防止 `python-legacy` runner、`route_request()` 与
  runtime audit helper 回流。
- `Phase 49-54` 已删除 Python supervisor-core residual `intent.py`、
  `scope_policy.py`、`query_policy.py`、`validation.py`、`context.py` 与
  `tool_policy.py`，Go runtime policy / execution 覆盖 residual 裁决 case，
  `packages/supervisor-core` 不再执行 Python target/tool matrix；Python worker cancel
  registry 仅保留 cancel flag store，不再发布 execution lifecycle counters。
- 下方 phase 定义保留为 closure record，便于后续 reopen 时判断边界与恢复点。

## Phase 0: Boundary And Baseline Freeze

**Goal:** 冻结 Go `apps/supervisor-api` 与 Python orchestration 的职责边界，并建立 legacy Python
`apps/supervisor-api` public entry 的行为基线。

**Scope:**

- inventory legacy Python `apps/supervisor-api` routes, auth modes, env vars and
  error shapes
- freeze Go `apps/supervisor-api` ownership and Python-owned semantics
- capture baseline latency, saturation and resource metrics where available
- define compatibility tests for `/api/v1/answer`, `/healthz`, `/readyz`

**Exit Criteria:**

- README / REQUIREMENTS / ROADMAP / STATE are current
- bridge direction is explicit
- no phase depends on rewriting `supervisor-core`

## Phase 1: Go Runtime Skeleton And Docker Harness

**Goal:** 建立可运行的 Go service skeleton 与 Docker-first 本地运行入口。

**Scope:**

- add Go module/package location for the future `apps/supervisor-api` runtime
- implement minimal HTTP server with `healthz` and static `readyz`
- add config loading for current supervisor env surface
- add Dockerfile / compose or repo-owned local harness
- add Go unit tests and root verification lane entry if needed

**Exit Criteria:**

- Go `apps/supervisor-api` starts locally
- Docker build/run path exists
- health route is test-covered

## Phase 2: Python Orchestration Bridge

**Goal:** 让 Go `apps/supervisor-api` 能调用现有 Python orchestration，而不改变业务语义。

**Scope:**

- choose bridge shape: subprocess, local HTTP, Unix socket or gRPC-like local seam
- preserve `SupervisorRequest` / `SupervisorResponse` JSON semantics
- propagate trace_id, actor/context, auth projection and request ids
- map Python orchestration errors to stable HTTP error bodies
- define bridge timeout and failure handling

**Exit Criteria:**

- Go `apps/supervisor-api` can execute a request through Python orchestration
- response parity is proven against legacy Python `apps/supervisor-api`
- bridge failure is observable and typed

## Phase 3: Auth, Admission And Backpressure

**Goal:** 把 internal caller auth、admission 和 backpressure 从 Python public execution entry 迁到 Go。

**Scope:**

- implement `bearer` and `trusted-worker` auth parity
- enforce request body limits and method/path validation
- implement Go-owned global admission and remove Python-side saturation semantics
- add forward-compatible per-lane budget model
- expose saturation counters and retry semantics

**Exit Criteria:**

- unauthorized, invalid JSON, saturated and success paths match contract expectations
- admitted requests do not exceed configured Go `apps/supervisor-api` budget
- lane model is present without forcing agent rewrite

## Phase 4: Cancellation And Streaming-Ready Lifecycle

**Goal:** 为 ChatGPT 式 stop 和后续 streaming 建立 execution lifecycle。

**Scope:**

- handle client disconnect and request context cancellation
- define cooperative cancellation signal to Python bridge
- add request lifecycle states needed by `app-api`
- keep non-streaming response compatibility
- document what cannot be cancelled until deeper Python cooperation exists

**Exit Criteria:**

- Go `apps/supervisor-api` stops waiting on disconnected clients where safe
- cancellation path is test-covered
- lifecycle semantics are explicit for `app-api`

## Phase 5: Observability, Audit And Readiness

**Goal:** 让 Go `apps/supervisor-api` 成为 Docker 侧 runtime truth 的 observability owner。

**Scope:**

- expose health, readiness and metrics for transport/admission/bridge/audit
- emit structured logs and audit events without blocking answer path
- surface prompt runtime readiness from Python or bridge health
- align with existing operator observability vocabulary
- define saturation and bridge issue fingerprints

**Exit Criteria:**

- readyz reflects Go `apps/supervisor-api` and Python bridge health
- metrics distinguish transport saturation, bridge failure and Python failure
- audit/logging does not block normal answer path

## Phase 6: Cutover, Capacity Gate And Runback

**Goal:** 完成从 Python HTTP entry 到 Go `apps/supervisor-api` 的 Docker-first cutover。

**Scope:**

- run parity tests against current Python entry
- run burst/capacity smoke for configured budget
- update Docker/runbook/env docs
- define canary and rollback process
- freeze accepted deployment shape

**Exit Criteria:**

- `app-api -> supervisor-api` can target Go `apps/supervisor-api` in staging/dev
- rollback/runback boundary is documented without reintroducing active Python public entry truth
- capacity and saturation behavior are measured
- docs reflect Go `apps/supervisor-api` as Docker execution entry once accepted

**Closeout Note:**

- repo-local parity rerun、local compose smoke、runback docs 已完成
- 环境侧 deploy adoption / canary / rollback 若后续执行，属于外部 rollout，不再阻塞当前
  workstream 的 repo-local closeout

## Phase 7: Runtime Kernel Hardening

**Goal:** 把 Go `apps/supervisor-api` 从 global admission bridge 升级为可取消、可分 lane、可观测的
Docker-side execution runtime kernel。

**Scope:**

- require non-empty `request_id` for answer execution lifecycle
- add in-flight lifecycle registry and duplicate `request_id` rejection
- add internal `POST /internal/execution/cancel` endpoint
- extend admission from global-only to global + per-lane budgets
- expose lane / lifecycle / telemetry readiness and metrics
- add OTel-first trace exporter seam with disabled-by-default local posture
- add best-effort execution audit event backflow to `app-api` internal ingest
- update compose env, runbooks and execution contract

**Exit Criteria:**

- explicit cancel releases the Go admission slot and returns typed lifecycle outcome
- slow / saturated `rag` lane does not block `navigation` lane admission
- `/readyz` reports `transport_runtime.lanes`, `lifecycle_runtime` and
  `telemetry_runtime`
- `/metrics` reports lane admission, lifecycle and telemetry counters
- execution audit backflow reports emitted / dropped / failed counters and never
  blocks answer requests
- OTel export is fail-open for answer path and does not emit raw `user_goal`
- `pnpm go:check`, focused docs lint, yaml lint and compose config pass or have
  documented unrelated blockers

## Phase 8: Python Cooperative Cancel Bridge

**Goal:** 让 Go explicit cancel 不只释放 Go wait path，还能向 Python orchestration worker
投递 request-scoped cooperative cancel signal。

**Scope:**

- add private Python bridge route `POST /internal/bridge/execution/cancel`
- add Python bridge active execution cancel registry
- extend Go bridge client with bounded cancel call
- keep Go cancel endpoint canonical response as `202 cancel_requested`
- expose cooperative cancel delivery outcome in metrics / response summary
- document that provider / prompt executor mid-flight stop is still not guaranteed

**Exit Criteria:**

- Go cancel endpoint attempts Go -> Python cooperative cancel for active executions
- Python bridge returns `202 cancel_requested` for active request ids and
  `404` for missing ids
- cancel delivery failure is fail-open for the cancel endpoint
- targeted Go and Python bridge tests cover the route

**Closeout Note:**

- Repo-local implementation is complete. Remaining provider / prompt executor
  mid-flight cancellation belongs to a later semantic-runtime slice.

## Phase 9: Structured Query Runtime Foundation

**Goal:** 在 Go `apps/supervisor-api` 中建立 gate-closed projection-backed structured query runtime
foundation，为 campus services tools 后续接入提供 internal query service seam。

**Scope:**

- add internal `/internal/query/campus-services/service-status`
- add internal `/internal/query/campus-services/transport-schedule`
- require `x-supervisor-query-auth`
- add file projection fixture backed service-status foundation
- keep `transport_schedule_lookup` as typed fail-closed seam pending contract
- expose `structured_query_runtime` in `/readyz`
- expose structured query counters in `/metrics`

**Exit Criteria:**

- service-status query can resolve a configured dev/test file projection fixture
- transport-schedule endpoint returns `temporarily_unverifiable` with
  `source_family_unavailable`
- no product `campus_services` serving surface is opened
- no Go runtime types leak into `packages/contracts`
- targeted Go tests cover auth, fixture resolution, fail-close and metrics

**Closeout Note:**

- Repo-local implementation is complete. The fail-closed transport seam has been
  superseded by Phase 10's projection-backed schedule query kernel.

## Phase 10: Transport Schedule Query Kernel

**Goal:** 在不打开 `campus_services` 产品 serving gate 的前提下，实现
`transport_schedule_lookup` 的 projection-backed deterministic query kernel。

**Scope:**

- parse schedule snapshot / route / scheduled departure / service exception
  projection records from the configured file bundle
- support `schedule_snapshot_metadata`, route clarification, `next_departure`,
  `first_departure`, `last_departure`, `departure_list`, `service_window` and
  `timetable`
- inject trusted runtime time from Go `apps/supervisor-api` context, never from user payload
- return fail-closed typed results when projection truth is unavailable
- add Python thin HTTP adapter and `supervisor-api` conditional wiring without
  changing product routing gate

**Exit Criteria:**

- Go unit and HTTP seam tests cover snapshot metadata, missing route
  clarification, tomorrow morning first departure, departure list filtering and
  temporary suspension
- Python adapter tests prove request posting, result decoding and answer shaping
- `supervisor-api` bridge test proves configured campus-services query service
  wiring
- Docs and workstream state clarify that runtime kernel readiness is not product
  serving admission

**Closeout Note:**

- Repo-local implementation is complete. Product serving admission remains
  deferred until opening-gate regression / eval evidence exists.

## Phase 11: Forward Capability Lane Alignment

**Goal:** 让 Go `apps/supervisor-api`、shared contract 与 supervisor validation 对齐已冻结的 forward
capability family，而不把 knowledge path 下的 structured runtime gate 自动打开。

**Scope:**

- extend `requested_capability` wire label to include `campus_services` and
  `notice`
- map `campus_services` and `notice` to their Go admission lanes
- keep `requested_scope` and non-current `version_query` knowledge-only
- allow explicit forward capability handoff to the corresponding specialist-owned
  structured runtime payload
- preserve existing knowledge-path structured runtime gate-closed behavior

**Exit Criteria:**

- Go execution parser tests prove `campus_services` / `notice` lane mapping
- supervisor validation tests prove forward capability acceptance and
  knowledge-only scope/version guards
- supervisor routing tests prove explicit capability handoff without opening
  knowledge-path gate
- docs clarify that internal execution alignment is not browser surface opening

**Closeout Note:**

- Repo-local implementation is complete. `app-api` surface capability policy
  remains the owner of product opening; public chat is not opened to
  `campus_services` / `notice` by this phase.

## Phase 12: Notice Read-Model Query Runtime Migration

**Goal:** 将 `campus_notice_discover` / `campus_notice_get` 的 deterministic
query-time read-model runtime 从 Python notice-agent 迁到 Go `apps/supervisor-api`。

**Scope:**

- add internal `POST /internal/query/notices/discover`
- add internal `POST /internal/query/notices/get`
- require `x-supervisor-query-auth`
- carry `payload + access_context` envelope so Go can enforce restricted
  internal notice authorization
- read `ingestion_projection.internal_notice_read_model` from PG
- read canonical markdown bodies from S3-compatible derived bucket
- convert Python `notice-agent` to HTTP thin adapter and remove Python PG/S3
  default runtime wiring
- keep notice product serving gate closed

**Exit Criteria:**

- Go tests prove discover, get, restricted auth fail-close and route auth
- Python tests prove notice-agent posts payload + authorization projection to Go
  and decodes typed results
- supervisor-api bridge tests prove configured structured query base URL / secret
  inject notice HTTP query service
- docs clarify Go owns notice PG/S3 query runtime and Python no longer owns
  direct read-model access

**Closeout Note:**

- Repo-local implementation is complete. Product serving admission remains
  deferred until opening-gate regression / eval evidence exists.

## Phase 13: Python Cancellation Checkpoints

**Goal:** 让 Go explicit cancel 不只停在 Python bridge registry，而能被默认
supervisor semantic orchestration checkpoints 观测。

**Scope:**

- expose request-scoped cancel checks from Python bridge registry
- check cancellation before / after supervisor handling in the bridge answer route
- pass cancellation checker into default `packages/supervisor-core` orchestration
- check cancellation around routing, RAG prompt execution, specialist delegation and
  finalization
- return typed `499 execution_cancelled` bridge terminal response without expanding
  `SupervisorStatus`

**Exit Criteria:**

- bridge cancel route can turn an active answer response into `499 execution_cancelled`
- Go maps bridge cancellation terminal response to lifecycle `canceled`
- targeted Python and Go tests cover both sides of the terminal response

**Closeout Note:**

- Repo-local implementation is complete. Provider / prompt HTTP hard-abort after the
  blocking call has started remains out of scope.

## Phase 14: Bridge Circuit Breaker

**Goal:** 防止 Python bridge transport / protocol failure 持续占用 execution slots。

**Scope:**

- add Go bridge circuit breaker with consecutive failure threshold and open window
- fail fast with `503 supervisor_bridge_circuit_open` while open
- expose circuit state in `/readyz` and `/metrics`
- reset breaker on valid bridge envelopes
- keep semantic supervisor errors out of transport-health failure accounting

**Exit Criteria:**

- repeated bridge failure opens the circuit
- open circuit rejects answer execution without calling Python bridge
- readiness degrades and metrics expose state / open / reject counters

**Closeout Note:**

- Repo-local implementation is complete. This does not replace `app-api` product-layer
  rate limit, duplicate-click UX or hotspot coalescing.

## Phase 15: Runtime Accounting Completion

**Goal:** 补齐 Go-owned runtime failure accounting 的 safe audit summary。

**Scope:**

- include measured bridge duration on bridge protocol / transport failure and cancel audit
  events
- include queue wait summary where an admitted request had to wait
- keep audit payload allowlisted and raw-content-free

**Exit Criteria:**

- execution audit failure events include bridge duration when measured
- payload remains compatible with `app-api` internal execution audit ingest
- targeted Go test covers bridge protocol failure duration accounting

**Closeout Note:**

- Repo-local implementation is complete. Token / cost accounting remains tied to upstream
  prompt runtime metadata and is not synthesized in Go.

## Phase 16: Service Status Runtime Hardening

**Goal:** 让 Go `service_status_lookup` 对 current-effective 查询保持 fail-close，不把过期或不完整
projection record 冒充成当前服务状态。

**Scope:**

- reject matched current records whose effective window is expired
- reject matched current records missing required status / effective / provenance fields
- return `temporarily_unverifiable/current_state_unverifiable` with
  `historical_downgrade_reason=current_effective_miss` when current effective truth
  cannot be proven
- keep source/raw scan out of query-time runtime

**Exit Criteria:**

- Go structured query tests cover expired effective window and incomplete matched
  record fail-close
- existing configured projection success path remains green

**Closeout Note:**

- Repo-local implementation is complete. This does not open `campus_services` product
  serving.

## Phase 17: Execution Audit Writer Hardening

**Goal:** 把 Go execution audit writer 从单次 best-effort post 升级为 batch / retry /
optional spool 的 fail-open writer。

**Scope:**

- add batch size and flush interval config
- retry failed batch delivery with bounded attempts and base delay
- optionally write exhausted batches to local spool under configured max bytes
- drain spool on startup
- expose retry/spool status in readiness and metrics

**Exit Criteria:**

- Go execution audit tests cover batching, retry-before-success and spool-after-retry
- audit payload allowlist remains raw-content-free
- answer path remains fail-open when audit delivery fails

**Closeout Note:**

- Repo-local implementation is complete. `app-api` remains the audit projection owner.

## Phase 18: OTel Sampling And Runtime Counters

**Goal:** 让 Go OTel exporter seam 可控采样、只发送 allowlisted attributes，并对 operator 暴露
export/drop/failure 状态。

**Scope:**

- add `SUPERVISOR_API_OTEL_SAMPLE_RATIO`
- keep span attributes allowlisted and raw-content-free
- expose exported / dropped / failed / sample ratio status through `/readyz` and
  `/metrics`

**Exit Criteria:**

- Go telemetry tests cover sample-out and attribute allowlist
- metrics include telemetry exported / dropped / failed / sample-ratio values

**Closeout Note:**

- Repo-local implementation is complete. Sentry/Axiom remain sinks, not panel truth.

## Phase 19: Lifecycle SSE Endpoint

**Goal:** 为 ChatGPT-like loading/stop UX 提供 internal lifecycle event stream，而不把 browser
直接接到 supervisor-api，也不承诺 token delta。

**Scope:**

- add `POST /api/v1/answer/stream`
- emit `execution.started`, `execution.queued`, `execution.running` and terminal
  completed / failed / cancelled SSE events
- map bridge circuit-open, timeout, invalid response, supervisor error and cancel into
  terminal event payloads
- add optional `app-api` supervisor adapter stream method that passes through the
  SSE response body

**Exit Criteria:**

- Go HTTP tests cover lifecycle success stream and circuit-open failure stream
- app-api adapter test proves `/api/v1/answer/stream` is called with canonical
  headers/body and response stream is not parsed

**Closeout Note:**

- Repo-local implementation is complete. Product route and browser stop UX remain
  owned by app-api/web workstreams.

## Phase 20: Capability Gate And Python Audit Cleanup

**Goal:** 让 Go `apps/supervisor-api` 拥有 deterministic effective capability /
lane inference 与 structured runtime opening gate，并从 Python bridge 移除本地
supervisor audit JSONL writer。

**Scope:**

- infer effective `requested_capability` when caller omits it, while preserving
  scoped / versioned knowledge path behavior
- reject closed `campus_services` / `notice` structured runtime requests before
  calling Python bridge
- expose capability gate state in `/readyz` and gate decision counters in
  `/metrics`
- add `SUPERVISOR_API_OPEN_CAPABILITIES` as the explicit Go-owned opening
  allowlist
- remove Python bridge local audit runtime, queue config, readyz field, and
  JSONL writer responsibility

**Exit Criteria:**

- Go execution tests cover capability inference and lane projection
- Go HTTP tests cover closed structured runtime rejection, stream terminal
  failure, open-gate bridge pass-through, readiness, and metrics
- Python bridge tests prove local audit log is not written and `audit_runtime`
  no longer degrades private readyz
- docs and workstream state identify Go as owner of audit writer/backflow and
  structured runtime opening gate

**Closeout Note:**

- Repo-local implementation is complete. Opening `campus_services` / `notice`
  for product serving still requires eval / regression evidence and product
  route admission; this phase only installs the runtime gate.

## Phase 21: Bridge Canonical Projection

**Goal:** 建立 Go-owned canonical request projection，并让 Python bridge 只消费该 private
envelope。

**Scope:**

- emit canonical bridge payload from Go `apps/supervisor-api`
- carry request id, trace, actor, context, user goal, effective capability, lane,
  scope/version and runtime decisions
- hardcut Python parser to the current private bridge envelope
- keep Go runtime types out of `packages/contracts`

**Exit Criteria:**

- Go tests cover bridge payload projection
- Python bridge tests cover current-envelope parsing and legacy rejection

**Closeout Note:**

- Repo-local implementation is complete. The bridge is a private
  `supervisor-api -> supervisor-core-worker` envelope, not a shared contract.

## Phase 22: Capability Scope Version Single Truth

**Goal:** 将 deterministic capability / scope / version entry decisions 单源迁到 Go。

**Scope:**

- infer effective capability and lane in Go
- reject scope/version fields outside knowledge path
- remove Python keyword inference truth
- keep Python validation as trust-but-verify

**Exit Criteria:**

- Go tests cover location, transport, notice, non-spatial "where to handle" and
  versioned notice-like queries
- Python tests prove missing Go decision fails closed

**Closeout Note:**

- Repo-local implementation is complete. Python no longer guesses capability from
  user text.

## Phase 23: Structured Payload Planner Migration

**Goal:** 将 deterministic structured payload planning 从 Python routing 迁到 Go。

**Scope:**

- build structured handoff payloads in Go `internal/structuredplanning`
- pass target, allowed tools, specialist request and planning outcome through
  `runtime_decisions.handoff`
- make Python routing consume the Go handoff

**Exit Criteria:**

- Go golden tests cover structured target / tool cases
- Python tests prove preplanned handoff is passed to supervisor-core

**Closeout Note:**

- Repo-local implementation is complete. Python no longer builds校车、service
  status or notice deterministic payloads at query time.

## Phase 24: Python Bridge Runtime Slimming

**Goal:** 将 execution runtime ownership 从 Python bridge 移出。

**Scope:**

- keep Python cancel registry as minimal cancel flag store
- publish lifecycle / cancel runtime truth from Go `/readyz` and `/metrics`
- slim Python `/internal/bridge/readyz` to prompt runtime, prompt HTTP pool and
  worker runtime

**Exit Criteria:**

- Go readiness tests prove runtime truth does not depend on Python lifecycle counters
- Python readyz tests prove execution runtime ownership is not exposed

**Closeout Note:**

- Repo-local implementation is complete. Python worker is a private semantic
  worker.

## Phase 25: Prompt Runtime Admission Boundary

**Goal:** 不迁 prompt/provider stack，只把 deterministic prompt admission summary 迁到 Go。

**Scope:**

- read env/model presence in Go
- publish Go-owned `prompt_config_gate`
- keep Python provider client and prompt executor creation in Python
- aggregate Python executor / pool health into Go readiness

**Exit Criteria:**

- missing key, missing model and strict structured output off produce stable Go
  readiness reasons
- Python provider/client failure is aggregated as degraded

**Closeout Note:**

- Repo-local implementation is complete. Prompt stack and provider executor remain
  Python-owned.

## Phase 26: Cleanup And Drift Guards

**Goal:** 删除重复 deterministic logic，并防止迁移内容回流到 Python supervisor-core。

**Scope:**

- remove Python capability keyword inference
- remove Python structured payload builder
- remove bridge legacy parser path
- add guard tests for planner / parser drift

**Exit Criteria:**

- focused Go / Python tests pass
- guard tests prevent reintroducing Python deterministic planner truth

**Closeout Note:**

- Repo-local implementation is complete. Remaining Python routing code is retained
  only for non-bridge fallback / tests where explicitly documented.

## Phase 27: All-Delegate Handoff Planner

**Goal:** 将 Go preplanned handoff 从 structured-only 扩展到 all-delegate path。

**Scope:**

- emit knowledge `rag_request` handoff from Go
- require preplanned handoff for bridge delegate routing
- remove Python fallback to `route_request()` and payload construction in
  `framing.py`

**Exit Criteria:**

- Go tests cover knowledge handoff projection
- Python tests prove missing handoff fails closed
- guard tests prevent RAG / navigation / structured payload builders returning to
  Python framing

**Closeout Note:**

- Repo-local implementation is complete. Python supervisor-core consumes the
  preplanned routing decision.

## Phase 28: Go Terminal Envelope

**Goal:** 让 Go 成为 non-delegate terminal response envelope owner。

**Scope:**

- build `terminal_envelope` for clarify, approval-required, out-of-scope and rejected
  decisions
- require `terminal_envelope` in Python bridge for non-delegate routing
- remove Python prompt-backed terminal response synthesis from supervisor-core

**Exit Criteria:**

- Go tests cover terminal envelope projection
- Python tests prove missing terminal envelope fails closed
- supervisor-core tests prove terminal response is consumed rather than synthesized

**Closeout Note:**

- Repo-local implementation is complete. Python finalization still handles
  specialist responses, not runtime terminal policy copy.

## Phase 29: Tool Policy Single Truth

**Goal:** 将 structured target/tool policy truth 收口到 Go runtime policy。

**Scope:**

- publish tool policy through bridge runtime decisions
- remove Python target -> allowed-tools matrix
- keep Python validation limited to payload kind vs Go-provided allowed tools
- add guard test against target-tool matrix reintroduction

**Exit Criteria:**

- Python tests validate payload/tool compatibility
- guard test fails if Python matrix or target-specific tool truth returns

**Closeout Note:**

- Repo-local implementation is complete. Python can reject malformed handoff but does
  not decide which tool a target may use.

## Phase 30: Runtime Decision Envelope

**Goal:** 将 bridge runtime decisions 收口为 nested private envelope，删除 flat planner
fields。

**Scope:**

- use `routing_frame`, `terminal_envelope`, `handoff`, `tool_policy` and
  `runtime_decision_summary`
- reject legacy bridge markers
- reject flat planner-field bridge shapes
- update Go and Python tests to current-envelope-only expectations

**Exit Criteria:**

- Go bridge projection tests assert nested current envelope shape
- Python bridge tests reject v2 and missing terminal / handoff fields
- guard scan blocks active legacy parser truth

**Closeout Note:**

- Repo-local implementation is complete. Legacy shape is not retained as an active
  runtime compatibility path.

## Phase 31: Direct Structured Runtime Answer Path

**Goal:** 对 opened structured capabilities，让 deterministic runtime path 可在 Go 中直接完成
`/api/v1/answer`。

**Scope:**

- execute Go structured runtime for `campus_services` and `notice` handoff payloads
  after opening gate admission
- avoid Python bridge for deterministic structured payloads on non-stream answer path
- wrap notice payload with `payload + access_context`
- shape supervisor-style response with selected target, status, result,
  observability and trace id

**Exit Criteria:**

- Go HTTP tests prove structured direct path succeeds without calling Python bridge
- notice direct path carries authorization context
- closed structured capability behavior remains fail-closed

**Closeout Note:**

- Repo-local implementation is complete. Streaming still uses lifecycle SSE bridge
  semantics; this phase only changes non-stream `/api/v1/answer`.

## Phase 32: Runtime Decision Observability Summary

**Goal:** 统一 runtime policy decision 的低基数观测口径。

**Scope:**

- add selected target/tool, terminal outcome and fail-close reason to runtime decision
  summary
- publish the summary through metrics, OTel attributes and execution audit events
- keep raw user text, prompts and provider payloads out of observability

**Exit Criteria:**

- Go metrics / telemetry / audit tests cover the added labels
- runtime decision labels remain bounded and raw-content-free

**Closeout Note:**

- Repo-local implementation is complete. Observability summarizes deterministic
  decisions, not semantic answer content.

## Phase 33: Closeout Guardrails And Docs

**Goal:** 删除残留旧口径，并防止 deterministic runtime planning 回流到 Python。

**Scope:**

- update supervisor-api, supervisor-core-worker, supervisor-core and architecture docs
- update workstream README / STATE / ROADMAP
- scan for legacy bridge and flat planner-field references
- keep guard tests for Python planner, parser and tool-policy drift

**Exit Criteria:**

- focused Go and Python verification passes
- docs lint and `git diff --check` pass
- active docs no longer describe legacy bridge or flat planner-field shapes as current truth

**Closeout Note:**

- Repo-local implementation is complete when the verification section in `STATE.md`
  records the fresh closeout commands for Phase 28-33.

## Phase 34: Bridge V4 Specialist Request Handoff

**Goal:** 让 Go handoff 直接投影完整 `SpecialistRequest`，删除 Python bridge 对
specialist request 的二次组装。

**Scope:**

- emit `supervisor_bridge_v4`
- replace handoff payload fragment with
  `runtime_decisions.handoff.specialist_request`
- pass trace, actor, context, payload and allowed tools through the Go-owned envelope
- hardcut Python parser to v4-only

**Exit Criteria:**

- Go tests cover full `SpecialistRequest` projection
- Python bridge tests reject older bridge versions and missing
  `handoff.specialist_request`

**Closeout Note:**

- Repo-local implementation is complete. The private bridge remains outside
  `packages/contracts`.

## Phase 35: Python Bridge Audit Emission Removal

**Goal:** 确保 Python bridge 不再发布 execution runtime audit truth。

**Scope:**

- remove bridge answer-path calls to supervisor audit builders
- keep package-level semantic audit projection available for tests / downstream
  semantic uses
- preserve Go execution audit writer / readiness / metrics as runtime truth

**Exit Criteria:**

- Python bridge tests prove answer / error paths do not call audit builders
- guard test blocks bridge API from importing runtime audit builders

**Closeout Note:**

- Repo-local implementation is complete. Python bridge runtime audit emission is
  removed.

## Phase 36: Stream Direct Structured Runtime

**Goal:** opened structured capability 的 lifecycle SSE 路径也能直接由 Go deterministic
runtime 完成。

**Scope:**

- route `/api/v1/answer/stream` opened structured handoff to Go direct runtime before
  Python bridge
- emit queued / running / completed or failed SSE lifecycle events
- keep closed structured runtime fail-closed semantics unchanged

**Exit Criteria:**

- Go HTTP tests prove opened structured stream path completes without Python bridge
- direct stream failures return terminal SSE failure events

**Closeout Note:**

- Repo-local implementation is complete. Streaming still emits lifecycle events, not
  token deltas.

## Phase 37: Supervisor Terminal Prompt Stack Removal

**Goal:** 删除已被 Go terminal envelope 取代的 production supervisor terminal prompt stack。

**Scope:**

- remove supervisor prompt executor, prompt packets, prompt registry and markdown
  templates from `packages/supervisor-core`
- keep RAG prompt executor / packet / registry path intact
- make prompt runtime admission require only the model used by the remaining
  provider-backed RAG executor

**Exit Criteria:**

- Python tests prove RAG prompt stack still works
- guard test proves deleted supervisor prompt stack files do not return
- Go and Python readiness admit when the removed supervisor terminal model is absent

**Closeout Note:**

- Repo-local implementation is complete. Deterministic supervisor terminal wording is
  Go direct terminal path truth.

## Phase 38: Final Docs And Drift Guards

**Goal:** 将 Phase 34-37 的实现口径落到 active docs，并补齐防回流测试。

**Scope:**

- update supervisor-api, supervisor-core-worker, supervisor-core and architecture docs
- update this workstream README / ROADMAP / STATE
- add / refresh guard tests for bridge v4, full `SpecialistRequest`, deleted framing,
  deleted supervisor prompt stack and Python bridge audit removal

**Exit Criteria:**

- focused Go and Python verification passes
- docs lint and `git diff --check` pass
- active docs no longer describe removed Python responsibilities as current truth

**Closeout Note:**

- Repo-local implementation is complete when the fresh Phase 34-38 verification is
  recorded in `STATE.md`.

## Phase 39: Go Direct Terminal Answer Path

**Goal:** Non-delegate runtime decisions 不再进入 Python bridge。

**Scope:**

- carry Go terminal envelope on parsed answer execution requests
- return non-stream terminal supervisor-style responses directly in Go
- emit lifecycle SSE terminal completed events directly in Go

**Exit Criteria:**

- Go tests prove terminal answer and stream paths do not call Python bridge
- terminal response includes request trace projection

**Closeout Note:**

- Repo-local implementation is complete.

## Phase 40: Python Bridge Delegate-Only Contract

**Goal:** Python private bridge 只接受 delegate handoff。

**Scope:**

- bridge parser returns `SupervisorRequest` plus `SpecialistRequest`
- reject routing frames whose next action is not `delegate`
- reject v4 requests missing `runtime_decisions.handoff.specialist_request`

**Exit Criteria:**

- Python bridge tests reject terminal frames
- Python bridge tests parse Go full `SpecialistRequest` handoff

**Closeout Note:**

- Repo-local implementation is complete.

## Phase 41: Supervisor Core Public API Slimming

**Goal:** `packages/supervisor-core` production public API 不再暴露 runtime routing /
audit sink knobs。

**Scope:**

- remove `preplanned_routing_decision` from `handle_request`
- remove `audit_sink` from production handler path
- remove runtime `audit_sink` surface while preserving Go-owned execution audit truth

**Exit Criteria:**

- guard tests prove public API has no runtime routing or audit sink surface
- focused supervisor tests use `preplanned_specialist_request`

**Closeout Note:**

- Repo-local implementation is complete.

## Phase 42: Production Core Routing Dependency Removal

**Goal:** Production core 不再依赖 `RoutingDecision`。

**Scope:**

- remove `RoutingDecision` imports from `agent.py`, `policy.py`, and package exports
- remove `finalize_routing_decision`
- remove production `RoutingDecision` dependencies while leaving legacy helper cleanup to
  follow-up closeout

**Exit Criteria:**

- guard tests prove production agent and public exports do not reference
  `RoutingDecision`
- policy tests cover only specialist finalization for production path

**Closeout Note:**

- Repo-local implementation is complete.

## Phase 43: Terminal Semantics Test Rehome

**Goal:** Terminal semantics 归 Go runtime tests 覆盖，Python core tests 不再模拟 terminal
envelope consumption。

**Scope:**

- move terminal direct assertions into Go HTTP tests
- update bridge parser tests to terminal-frame rejection
- update Python core tests to delegate-only handoff behavior

**Exit Criteria:**

- Python supervisor tests no longer call `finalize_routing_decision`
- Go HTTP tests cover terminal direct non-stream and stream paths

**Closeout Note:**

- Repo-local implementation is complete.

## Phase 44: Docs And Boundary State Refresh

**Goal:** Active docs 反映 Go terminal direct 与 Python delegate-only 边界。

**Scope:**

- update supervisor-api, supervisor-core-worker, supervisor-core README files
- update current architecture and execution / prompt architecture docs
- update workstream README / ROADMAP / STATE

**Exit Criteria:**

- docs no longer describe Python bridge/core as terminal envelope consumer
- docs lint passes

**Closeout Note:**

- Repo-local implementation is complete.

## Phase 45: Verification And Drift Guard Closeout

**Goal:** 防止 Python runtime routing / terminal handling 回流。

**Scope:**

- refresh guard tests for production core public API
- run focused Python and Go checks
- run drift scan for forbidden production symbols

**Exit Criteria:**

- `pnpm go:check` passes
- focused Python unittest and ruff checks pass
- docs lint and diff check pass
- drift scan only reports allowed legacy helpers / guard-test strings

**Closeout Note:**

- Repo-local implementation is complete when fresh verification is recorded in
  `STATE.md`.

## Phase 46: Remove Python Audit Helper Remainder

**Goal:** 删除 Python worker stale audit seam 与 supervisor-core direct `audit.py` helper。

**Scope:**

- delete worker-side stale audit helper
- delete supervisor-core direct audit projection helper
- keep execution audit ownership in Go `apps/supervisor-api`
- refresh supervisor-core docs and guard tests

**Exit Criteria:**

- guard tests prove Python runtime audit helpers do not exist
- Python bridge API no longer imports or emits runtime audit records

**Closeout Note:**

- Repo-local implementation is complete when fresh verification is recorded in
  `STATE.md`.

## Phase 47: Intent Eval Go Runner Hardcut

**Goal:** Intent eval 不再通过 Python legacy routing helper 评估 runtime policy。

**Scope:**

- remove `python-legacy` runner choice
- remove direct `campus_supervisor_core.routing` import from intent eval runner
- use Go `supervisor-api` runtime-policy runner as the only supported runner
- keep report aggregation logic in Python eval package

**Exit Criteria:**

- intent eval runner tests execute through Go runner
- guard tests reject `python-legacy`, `route_request()` and `evaluate_intent_case`
  reintroduction

**Closeout Note:**

- Repo-local implementation is complete when fresh verification is recorded in
  `STATE.md`.

## Phase 48: Delete Legacy Routing Helper And Drift Guards

**Goal:** 删除 legacy `packages/supervisor-core/routing.py`，防止 deterministic runtime
planner 回流到 Python core。

**Scope:**

- delete `packages/supervisor-core/src/campus_supervisor_core/routing.py`
- delete legacy Python routing tests
- update supervisor-core README and workstream state
- run focused Go / Python checks and active drift scan

**Exit Criteria:**

- guard tests prove `routing.py` does not exist
- focused intent, supervisor, Go, ruff, docs and diff checks pass
- active drift scan only reports intentionally allowed guard / closure-record strings

**Closeout Note:**

- Repo-local implementation is complete when fresh verification is recorded in
  `STATE.md`.

## Phase 49: Delete Legacy Intent And Scope Helpers

**Goal:** 删除 Python `intent.py` / `scope_policy.py`，让 runtime intent frame 与 scope gate
truth 只由 Go runtime policy 发布。

**Scope:**

- delete Python intent and scope helper modules
- rehome residual scope cases to Go runtime policy tests
- remove Python tests that directly call legacy scope helpers

**Exit Criteria:**

- no production Python import references legacy intent / scope helpers
- Go runtime policy tests cover residual scope gate cases

**Closeout Note:**

- Repo-local implementation is complete when fresh verification is recorded in
  `STATE.md`.

## Phase 50: Delete Legacy Query And Validation Helpers

**Goal:** 删除 Python `query_policy.py` / `validation.py`，让 query-serving scope 与
capability/scope/version guard 只由 Go execution admission 覆盖。

**Scope:**

- delete Python query and validation helper modules
- rehome query-serving scope profile tests to Go runtime policy tests
- add Go execution guard coverage for residual version/scope invalid combinations

**Exit Criteria:**

- Python core no longer imports query / validation helpers
- Go execution tests cover residual admission guard behavior

**Closeout Note:**

- Repo-local implementation is complete when fresh verification is recorded in
  `STATE.md`.

## Phase 51: Delete Legacy Context Projection Helper

**Goal:** 删除 Python `context.py` request projection helper，避免 Python core 继续维护
runtime request context truth。

**Scope:**

- delete Python context helper module
- remove context-helper-only tests from supervisor-core suites
- keep bridge parser DTO validation in Python worker boundary

**Exit Criteria:**

- Python supervisor-core no longer exposes `SupervisorRequestContext`
- remaining context projection coverage lives in Go bridge / execution tests or
  worker parser tests

**Closeout Note:**

- Repo-local implementation is complete when fresh verification is recorded in
  `STATE.md`.

## Phase 52: Delete Legacy Tool Policy Helper

**Goal:** 删除 Python `tool_policy.py`，让 structured target/tool policy 保持 Go-owned
runtime policy truth。

**Scope:**

- delete Python target/tool policy helper module
- remove Python `InvalidSpecialistToolPolicyError`
- update supervisor-core specialist policy tests to assert Go preplanned handoff is
  delegated without Python target/tool matrix

**Exit Criteria:**

- Python core no longer imports target/tool policy helper
- Go runtime policy tests own allowed-tool matrix coverage

**Closeout Note:**

- Repo-local implementation is complete when fresh verification is recorded in
  `STATE.md`.

## Phase 53: Python Cancel Runtime Counter Slimming

**Goal:** Python worker cancel registry 只保留 request-scoped cancel flag store，不再发布
execution lifecycle runtime truth。

**Scope:**

- remove active execution and cancel requested counters from Python registry status
- keep register / cancel / is-cancel-requested / complete behavior
- ensure bridge readyz only reports prompt runtime, prompt HTTP pool and minimal worker runtime

**Exit Criteria:**

- guard tests prove Python bridge API does not publish cancel counters
- Go readiness / metrics remain runtime truth owner

**Closeout Note:**

- Repo-local implementation is complete when fresh verification is recorded in
  `STATE.md`.

## Phase 54: Docs And Drift Guard Closeout

**Goal:** 更新 docs / workstream state，并增加 guard 防止 Python residual 回流。

**Scope:**

- update supervisor-core / worker docs and go-shell workstream state
- add guard coverage for deleted helper modules and legacy intent observability helper
- run focused Go, Python, ruff, docs and drift checks

**Exit Criteria:**

- docs reflect Python semantic-worker-only boundary
- focused verification passes or records blockers
- active drift scan reports only guard-test strings and descriptive closure records

**Closeout Note:**

- Repo-local implementation is complete when fresh verification is recorded in
  `STATE.md`.

## Phase 55: Go Supervisor Response Finalizer

**Goal:** 让 Go `supervisor-api` 成为 public `SupervisorResponse` finalization 与
response observability owner，Python bridge / `packages/supervisor-core` 只返回
private `SpecialistResponse`。

**Scope:**

- upgrade private bridge envelope to `supervisor_bridge_v5`
- require `response_contract=specialist_response` on Python bridge requests
- make Python bridge return `x-supervisor-bridge-kind: specialist_response`
- finalize bridge `SpecialistResponse` into public `SupervisorResponse` in Go
- delete Python `policy.py` / `response.py` and legacy `handle_request`
- update docs / guard coverage for the slimmed Python core boundary

**Exit Criteria:**

- Go tests prove bridge `specialist_response` is finalized into the public envelope
- Python bridge tests reject v4 / missing specialist response contract
- active Python supervisor-core no longer imports finalization / response helper modules
- focused Go, Python, ruff, docs and diff checks pass or record blockers

**Closeout Note:**

- Repo-local implementation is complete when fresh verification is recorded in
  `STATE.md`.

## Phase 56: Python Agent Dispatch Naming Closeout

**Goal:** 退役 active Python core 中误导性的 supervisor/specialist runtime naming，保留
shared wire contract 的 `SpecialistRequest` / `SpecialistResponse` 名称不变。

**Scope:**

- rename `SupervisorAgent` to `AgentDispatcher`
- rename `handle_specialist_request` to `dispatch_agent_request`
- rename `SpecialistDelegate` to `AgentDelegate`
- rename worker `specialist_handler` parameters to `agent_handler`

**Exit Criteria:**

- active Python code no longer exposes `SupervisorAgent` or `handle_specialist_request`
- focused tests use `AgentDispatcher` / `dispatch_agent_request`

## Phase 57: Move Default Agent Registry To Worker

**Goal:** `packages/supervisor-core` 不再 import concrete agent packages；default delegate map
属于 Python worker runtime assembly。

**Scope:**

- move rag / navigation / campus-services / notice delegate registry to
  `apps/supervisor-core-worker`
- keep `packages/supervisor-core` limited to injected delegate dispatch
- keep RAG prompt executor and structured query service injection in worker

**Exit Criteria:**

- `packages/supervisor-core` imports no concrete agent package
- worker tests cover default registry through bridge behavior

## Phase 58: Dispatcher Package Boundary

**Goal:** 把 `packages/supervisor-core` 收敛为 thin private dispatcher helper。

**Scope:**

- replace `agent.py` with `dispatcher.py`
- keep only `dispatcher.py`, `errors.py`, and package export surface
- remove legacy supervisor-core public handler naming

**Exit Criteria:**

- `agent.py` is deleted
- public Python core API exposes only dispatcher-oriented names

## Phase 59: Agent Dispatch Error Slimming

**Goal:** 删除旧 supervisor validation error model，只保留真实会从 dispatch path 抛出的错误。

**Scope:**

- rename `MissingSpecialistDelegateError` to `MissingAgentDelegateError`
- replace `SupervisorError` with private `AgentDispatchError`
- remove unused `InvalidSupervisorRequestError` and `DisallowedKnowledgeScopeError`

**Exit Criteria:**

- active Python code imports only real dispatch errors
- bridge error tests use dispatch error semantics

## Phase 60: Docs And Drift Guard Closeout

**Goal:** 更新 docs / planning，并防止旧 Python supervisor core 命名和默认 agent registry 回流。

**Scope:**

- update supervisor-core / worker / architecture docs
- update go-shell workstream state
- add guard coverage for deleted naming and concrete agent imports
- run focused Go, Python, ruff, docs and drift checks

**Exit Criteria:**

- docs reflect agent-dispatch-only Python core boundary
- active drift scan reports only allowed wire-contract `Specialist*` names and
  historical closure records

## Phase 61: Internal Agent Handoff Naming Closeout

**Goal:** 把 worker / tests / docs 的 active implementation 命名从 specialist residual
收口到 agent handoff，同时不修改 bridge v5 / shared contracts 的 legacy wire 名称。

**Scope:**

- rename worker-local `preplanned_specialist_request` /
  `runtime_specialist_request` variables to agent request naming
- rename bridge parser helper functions from specialist parser names to agent
  handoff parser names while preserving `runtime_decisions.handoff.specialist_request`
  wire path
- rename supervisor focused test suite from specialist policy to agent handoff
- update docs / guard coverage so `SpecialistRequest` / `SpecialistResponse` remain
  explicitly documented as legacy wire contract names only

**Exit Criteria:**

- focused guard proves worker internals no longer use specialist aliases for agent
  handoff implementation names
- bridge/API behavior remains unchanged
- focused Python, ruff, docs and diff checks pass or record blockers
