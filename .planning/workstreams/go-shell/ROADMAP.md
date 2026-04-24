---
doc_type: roadmap
status: active
created: 2026-04-23
updated: 2026-04-24
---

# Roadmap: go-shell

## Current Progress

- `Phase 0-9` repo-local implementation 已完成。
- 当前 `Phase 8-9` 已补齐 Go -> Python cooperative cancel signal 与 Go
  structured query runtime foundation。
- `transport_schedule_lookup` 的业务查询实现仍等待 schedule contract 讨论完成后进入
  后续 phase；当前只保留 typed fail-closed seam。
- 下方 phase 定义保留为 closure record，便于后续 reopen 时判断边界与恢复点。

## Phase 0: Boundary And Baseline Freeze

**Goal:** 冻结 Go shell 与 Python orchestration 的职责边界，并建立当前 Python
`supervisor-api` 的行为基线。

**Scope:**

- inventory current `apps/supervisor-api` routes, auth modes, env vars and
  error shapes
- freeze Go shell ownership and Python-owned semantics
- capture baseline latency, saturation and resource metrics where available
- define compatibility tests for `/api/v1/answer`, `/healthz`, `/readyz`

**Exit Criteria:**

- README / REQUIREMENTS / ROADMAP / STATE are current
- bridge direction is explicit
- no phase depends on rewriting `supervisor-core`

## Phase 1: Go Shell Skeleton And Docker Harness

**Goal:** 建立可运行的 Go service skeleton 与 Docker-first 本地运行入口。

**Scope:**

- add Go module/package location for `go-shell`
- implement minimal HTTP server with `healthz` and static `readyz`
- add config loading for current supervisor env surface
- add Dockerfile / compose or repo-owned local harness
- add Go unit tests and root verification lane entry if needed

**Exit Criteria:**

- Go shell starts locally
- Docker build/run path exists
- health route is test-covered

## Phase 2: Python Orchestration Bridge

**Goal:** 让 Go shell 能调用现有 Python orchestration，而不改变业务语义。

**Scope:**

- choose bridge shape: subprocess, local HTTP, Unix socket or gRPC-like local seam
- preserve `SupervisorRequest` / `SupervisorResponse` JSON semantics
- propagate trace_id, actor/context, auth projection and request ids
- map Python orchestration errors to stable HTTP error bodies
- define bridge timeout and failure handling

**Exit Criteria:**

- Go shell can execute a request through Python orchestration
- response parity is proven against current Python `supervisor-api`
- bridge failure is observable and typed

## Phase 3: Auth, Admission And Backpressure

**Goal:** 把 internal caller auth、admission 和 backpressure 从 Python shell 迁到 Go。

**Scope:**

- implement `bearer` and `trusted-worker` auth parity
- enforce request body limits and method/path validation
- implement Go-owned global admission and remove Python-side saturation semantics
- add forward-compatible per-lane budget model
- expose saturation counters and retry semantics

**Exit Criteria:**

- unauthorized, invalid JSON, saturated and success paths match contract expectations
- admitted requests do not exceed configured Go shell budget
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

- Go shell stops waiting on disconnected clients where safe
- cancellation path is test-covered
- lifecycle semantics are explicit for `app-api`

## Phase 5: Observability, Audit And Readiness

**Goal:** 让 Go shell 成为 Docker 侧 runtime truth 的 observability owner。

**Scope:**

- expose health, readiness and metrics for transport/admission/bridge/audit
- emit structured logs and audit events without blocking answer path
- surface prompt runtime readiness from Python or bridge health
- align with existing operator observability vocabulary
- define saturation and bridge issue fingerprints

**Exit Criteria:**

- readyz reflects Go shell and Python bridge health
- metrics distinguish transport saturation, bridge failure and Python failure
- audit/logging does not block normal answer path

## Phase 6: Cutover, Capacity Gate And Runback

**Goal:** 完成从 Python HTTP entry 到 Go shell 的 Docker-first cutover。

**Scope:**

- run parity tests against current Python entry
- run burst/capacity smoke for configured budget
- update Docker/runbook/env docs
- define canary and rollback process
- freeze accepted deployment shape

**Exit Criteria:**

- `app-api -> supervisor-api` can target Go shell in staging/dev
- rollback to Python entry is documented
- capacity and saturation behavior are measured
- docs reflect Go shell as Docker execution entry once accepted

**Closeout Note:**

- repo-local parity rerun、local compose smoke、runback docs 已完成
- 环境侧 deploy adoption / canary / rollback 若后续执行，属于外部 rollout，不再阻塞当前
  workstream 的 repo-local closeout

## Phase 7: Runtime Kernel Hardening

**Goal:** 把 Go shell 从 global admission bridge shell 升级为可取消、可分 lane、可观测的
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

**Goal:** 在 Go shell 中建立 gate-closed projection-backed structured query runtime
foundation，为 campus services tools 后续接入提供 internal query service seam。

**Scope:**

- add internal `/internal/query/campus-services/service-status`
- add internal `/internal/query/campus-services/transport-schedule`
- require `x-supervisor-query-auth`
- add file projection fixture backed service-status foundation
- keep `transport_schedule_lookup` as typed fail-closed seam pending contract
  discussion
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

- Repo-local foundation is complete. Actual `transport_schedule_lookup` business
  implementation is intentionally deferred until schedule contract discussion is
  complete.
