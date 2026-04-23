---
doc_type: roadmap
status: active
created: 2026-04-23
updated: 2026-04-23
---

# Roadmap: go-shell

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
- implement global admission parity with current `transport_saturated`
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
