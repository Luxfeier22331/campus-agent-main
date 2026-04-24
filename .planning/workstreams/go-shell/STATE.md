---
doc_type: state
status: active
created: 2026-04-23
updated: 2026-04-24
---

# State: go-shell

## Current Status

- status: `active`
- current phase: `Phase 12 closeout`
- current slice: Go shell runtime kernel hardening、Python cooperative cancel
  bridge、structured query runtime foundation 与 `transport_schedule_lookup`
  projection-backed deterministic query kernel 已落地；forward capability label /
  lane alignment 已补齐；`campus_notice_discover` / `campus_notice_get` 的 Go
  read-model query runtime 已落地；产品主路由 gate 仍保持关闭
- owner: unassigned
- active implementation: yes, `apps/go-shell`

## Captured Context

2026-04-23 讨论结论：

- 用户希望创建短名持久化 workstream，名称确定为 `go-shell`。
- 范围是 Docker 部署侧，不涉及 Worker 侧选型。
- Python 性能和服务器预算是主要驱动，但迁移必须保持边界正确。
- 第一刀不是 Go 重写 `supervisor-core`，而是迁移 execution shell：
  - HTTP transport / dispatch
  - internal caller auth
  - admission / backpressure / lane budgets
  - cancellation / streaming lifecycle
  - health / readiness / metrics
  - audit/logging runtime
  - Python orchestration bridge
- 更宽的 Go/Rust/Python split 保留在
  `supervisor-docker-runtime-language-split` backlog。

2026-04-23 技术栈结论：

- 第一轮迁 runtime shell，不迁业务 agent。
- Go 侧使用标准库 `net/http` / `http.ServeMux`、`context.Context`、
  `log/slog`、`testing` / `httptest`；当前 slice 以 shell-owned `/metrics` 与
  structured logs 承接 observability，OTel collector / sink fan-out 留待后续重开。
- 第一版 bridge 使用 private loopback HTTP/JSON 调用长驻 Python orchestration
  worker，不默认引入 UDS 或 gRPC。
- `app-api` 继续拥有产品层限流；Go shell 只拥有 execution admission /
  backpressure。
- provider-backed prompt executor 和 prompt stack assembly 暂不迁，除非后续
  profiling 证明它们是 Go shell 稳定后的下一条瓶颈线。

## Blockers

- repo-local Phase 8-12 implementation 当前无 blocker。
- repo-owned environment-side hard-cut automation 当前无 blocker。
- `chat-capacity-and-cancellation-hardening` 若后续恢复，会影响 product-layer
  stop/cancel UX、request lifecycle projection 与 browser duplicate-submit guard；
  当前 go-shell 只实现 execution-side cancel 和 Go -> Python cooperative cancel
  signal。
- `transport_schedule_lookup` 的 runtime kernel 已实现；opening gate 仍需要 eval /
  regression evidence、产品路由 admission 与真实 projection 数据接入决策。
- `campus_notice_discover` / `campus_notice_get` 的 runtime kernel 已实现；
  opening gate 仍需要 eval / regression evidence 与产品路由 admission 决策。

## Verification

- Go check passed on 2026-04-23:
  Later rerun also passed on 2026-04-24.

  ```bash
  PATH="/home/reptilian/code/campus-agent/.tmp/go-toolchain/go/bin:$PATH" pnpm go:check
  ```

- `pnpm docker:lint` passed on 2026-04-23.
- Focused markdown lint for `apps/go-shell/README.md` and workstream docs passed
  on 2026-04-23.
- `docker build -f apps/go-shell/Dockerfile -t campus-go-shell:local .` passed on
  2026-04-23.
- `docker build -f apps/supervisor-api/Dockerfile`
  `-t campus-supervisor-orchestrator:local .` passed on 2026-04-23.
- Container smoke passed on 2026-04-23:
  - `GET /healthz` on Go shell returns `200`.
  - `GET /readyz` on Go shell returns aggregated `503 degraded`
    when Python worker prompt runtime is not admitted.
  - `POST /api/v1/answer` through the two-container harness returns `200`
    with current Python orchestration semantics
    (`needs_clarification` in the recorded smoke).
- Updated local compose smoke passed again on 2026-04-24 with artifacts under
  `.tmp/go-shell-local-smoke/20260424T011207/`:
  - `healthz.json`
  - `readyz.json`
  - `metrics-final-clean.txt`
  - `answer-final.http`
- Python compatibility parity rerun passed on 2026-04-24:
  - `python-answer.json` and `go-shell-answer-parity.json` matched on
    `selected_target` / `status` / `follow_up_question` / `confidence` /
    `trace_id`
- Focused markdown lint passed on 2026-04-24 for:
  - `apps/go-shell/README.md`
  - `docs/runbooks/go-shell-local-runtime-smoke.md`
  - `docs/runbooks/README.md`
- Environment-side hard-cut support validation passed on 2026-04-24:
  - `bash -n` passed for `infra/local/staging/go-shell-staging-common.sh` and all
    `go-shell-staging*.sh` lifecycle scripts
  - `docker compose -f infra/local/docker-compose.supervisor-runtime.yml config`
    passed with dummy bridge / worker secrets
  - `uv run --all-packages python -m scripts.doctor_env supervisor-api --json`
    passed
  - focused markdown lint passed for changed go-shell staging docs and
    workstream docs
- Phase 7 runtime-kernel verification passed on 2026-04-24:
  - `PATH="$PATH:$(go env GOPATH)/bin" pnpm go:check`
  - `pnpm exec markdownlint-cli2` for touched go-shell docs / contracts /
    architecture docs / runbooks / workstream docs
  - `pnpm yaml:lint`
  - `docker compose -f infra/local/docker-compose.supervisor-runtime.yml config`
    with dummy bridge / worker secrets
- Full `pnpm docs:lint` remains blocked by unrelated existing tracked markdown
  baseline errors in generated `apps/public-docs` content and other docs outside
  this workstream.
- Execution audit focused verification passed on 2026-04-24:
  - `pnpm --dir apps/app-api test:node --`
    `operator-observability-ingest.route.test.ts`
    `operator-observability-command.service.test.ts`
    `projection.service.test.ts telemetry.axiom.test.ts`
  - `go test ./... -count=1` in `apps/go-shell`
- Phase 8-9 targeted red/green verification passed on 2026-04-24:
  - `PATH="$PATH:$(go env GOPATH)/bin" go test ./internal/bridge`
    `./internal/httpapi ./internal/structuredquery -count=1`
  - `uv run --all-packages python -m unittest`
    `tests.api.supervisor_api_bridge_suite`
- Phase 10 transport schedule query kernel verification passed on 2026-04-24:
  - `PATH="$PATH:$(go env GOPATH)/bin" pnpm go:check`
  - `uv run --all-packages python -m unittest`
    `tests.specialist.test_campus_services_agent`
    `tests.api.supervisor_api_bridge_suite`
    `tests.api.test_supervisor_api_asgi`
  - `uv run --all-packages ruff check apps/supervisor-api/src/campus_supervisor_api`
    `packages/campus-services-agent/src/campus_services_agent`
    `tests/api/supervisor_api_bridge_suite.py`
    `tests/specialist/test_campus_services_agent.py`
  - `uv run --all-packages ruff format apps/supervisor-api/src/campus_supervisor_api`
    `packages/campus-services-agent/src/campus_services_agent`
    `tests/api/supervisor_api_bridge_suite.py`
    `tests/specialist/test_campus_services_agent.py --check`
  - `pnpm docs:lint`
  - `pnpm yaml:lint`
- Phase 11 forward capability lane alignment focused red/green verification
  passed on 2026-04-24:
  - `PATH="/home/reptilian/code/campus-agent/.tmp/go-toolchain/go/bin:$PATH"`
    `go test ./internal/execution -count=1`
  - `uv run --all-packages python -m unittest`
    `tests.supervisor.test_supervisor_validation`
    `tests.supervisor.test_supervisor_routing`
- Phase 11 broader verification passed on 2026-04-24:
  - `PATH="/home/reptilian/code/campus-agent/.tmp/go-toolchain/go/bin:$PATH"`
    `go test ./... -count=1` in `apps/go-shell`
  - `PATH="/home/reptilian/code/campus-agent/.tmp/go-toolchain/go/bin:$PATH"`
    `go vet ./...` in `apps/go-shell`
  - `PATH="/home/reptilian/code/campus-agent/.tmp/go-toolchain/go/bin:$PATH"`
    `test -z "$(gofmt -l apps/go-shell)"`
  - `uv run --all-packages python -m unittest`
    `tests.contracts.contract_models_request_and_retrieval_suite`
    `tests.supervisor.test_supervisor_validation`
    `tests.supervisor.test_supervisor_routing`
    `tests.api.supervisor_api_bridge_suite`
  - `uv run --all-packages python -m unittest` for the importable supervisor
    suite modules
  - focused `ruff check` / `ruff format --check` for touched Python files
  - `pnpm docs:lint`
  - `pnpm go:check` did not complete because local environment lacks
    `golangci-lint v2.11.4`; its gofmt / go vet stages had already passed before
    the missing linter guard failed
- Phase 12 notice read-model query runtime focused red/green verification passed
  on 2026-04-24:
  - `PATH="$PWD/.tmp/go-toolchain/go/bin:$PWD/.tmp/go-tools/bin:$PATH"`
    `go test ./internal/structuredquery ./internal/config ./internal/httpapi -count=1`
    in `apps/go-shell`
  - `uv run --all-packages python -m unittest`
    `tests.specialist.test_notice_runtime_wiring`
    `tests.specialist.test_notice_agent`
    `tests.api.supervisor_api_bridge_suite`

## Continuity Notes

- 不把 Go runtime 类型泄漏进 `packages/contracts`。
- 不把 product-layer auth/session/rate-limit/request projection 移入 `supervisor-core`。
- Go shell 应兼容当前 `app-api -> supervisor-api` internal execution contract。
- Python orchestration bridge 是迁移安全阀，不是长期腐烂兼容层；每个保留边界都要有 owner。
- Go structured query runtime 是 internal query service seam，不是 product API、
  browser-facing tool endpoint 或 `app-api` control plane。
- `transport_schedule_lookup` 当前已有 runtime kernel；不得把 runtime kernel readiness
  冒充成 product serving lane opening。
- `campus_services` / `notice` 作为 explicit internal execution capability label
  可进入对应 Go lane；这不等同于 public chat surface 已开放这些 capability。

## Completed Implementation

2026-04-23:

- Added `apps/go-shell` Go module targeting Go `1.26.x`.
- Added `net/http` service entrypoint with structured `slog` JSON logging.
- Added `/healthz`, `/readyz` and `/api/v1/answer`.
- Added request body limit handling, strict top-level JSON object validation and
  fail-closed `bridge_not_configured` behavior.
- Added global admission limiter with transport saturation status.
- Added Dockerfile with container listener configured via
  `CAMPUS_AGENT_HTTP_HOST=0.0.0.0`.
- Added root `pnpm go:check` lane and GitHub Actions `go-shell` job.
- Added Go-side external request projection with `bearer` / `trusted-worker`
  auth parity and stable `SupervisorRequest` bridge payload encoding.
- Added private HTTP bridge client for `/internal/bridge/supervisor/answer` and
  `/internal/bridge/readyz`.
- Added `/readyz` aggregation that preserves Python worker runtime status while
  publishing Go transport admission as `transport_runtime`.
- Added repo-owned Python orchestration worker Dockerfile and local compose
  harness at `infra/local/docker-compose.supervisor-runtime.yml`.
- Added Go unit coverage for execution projection, bridge client and bridge
  response handling.
- Confirmed live two-container smoke with Go shell fronting Python orchestration.
- Added shell-owned Prometheus-style `/metrics` endpoint.
- Added shell-owned request metrics for request total, duration, inflight,
  transport saturation and bridge failure classes.
- Added answer-path structured logs with `trace_id`, `status_code`, `outcome`
  and `duration_ms`.
- Added bridge answer success/failure fingerprint fields to `/readyz`.
- Added cancellation-path behavior that stops waiting on bridge calls after
  client disconnect.
- Added repo-owned local smoke / shutdown runbook at
  `docs/runbooks/go-shell-local-runtime-smoke.md`.
- Confirmed Go shell front-door behavior against the private Python
  orchestration bridge with the same `trusted-worker` request and fixed
  `trace_id`.
- Added repo-owned staging hard-cut lifecycle scripts under
  `infra/local/staging/go-shell-staging-*`.
- Added repo-owned go-shell staging scheduled-task installer.
- Added canonical staging runbooks:
  - `docs/runbooks/go-shell-staging-operations.md`
  - `docs/runbooks/go-shell-staging-smoke-runbook.md`
- Removed active dev-backed Python public ingress scripts and runbooks after
  the Go shell hardcut.

## Phase 7 Completed Implementation

- non-empty `request_id` is required for answer execution lifecycle
- Go in-flight lifecycle registry rejects duplicate active `request_id`
- `POST /internal/execution/cancel` marks active execution as
  `cancel_requested` and releases the Go wait path
- admission now supports global + per-lane budgets for `rag`, `navigation`,
  `campus_services`, `notice` and `default`
- `/readyz` and `/metrics` expose lane, lifecycle final-state and telemetry
  runtime state
- OTel trace exporter seam is disabled by default and fail-open on answer path
- execution audit emitter is disabled by default, fail-open, bounded, and sends
  only allowlisted runtime events to `app-api` internal ingest
- `/readyz` and `/metrics` expose execution audit runtime status without making
  audit sink health a readiness blocker

## Phase 8 Completed Implementation

- Go bridge client now calls Python private
  `POST /internal/bridge/execution/cancel`
- Go cancel endpoint returns `bridge_cancel_status` while preserving
  `202 cancel_requested` for active executions
- Python bridge owns an active execution cancel registry
- Python bridge cancel route returns `202 cancel_requested` for active request ids
  and `404 execution_not_found` otherwise
- cooperative cancel metrics are exposed under `/metrics`
- provider / prompt executor mid-flight cancellation remains out of scope

## Phase 9 Completed Implementation

- Go shell exposes internal structured query routes:
  - `POST /internal/query/campus-services/service-status`
  - `POST /internal/query/campus-services/transport-schedule`
- structured query routes require `x-supervisor-query-auth`
- `service_status_lookup` can resolve a configured file projection fixture
- `transport_schedule_lookup` initially returned `temporarily_unverifiable` with
  `source_family_unavailable`; this fail-closed seam was superseded by Phase 10
- `/readyz` reports `structured_query_runtime`
- `/metrics` reports `campus_go_shell_structured_query_requests_total`

## Phase 10 Completed Implementation

- `transport_schedule_lookup` reads configured schedule projection records:
  - `transport_schedule_snapshots`
  - `transport_routes`
  - `scheduled_departures`
  - `transport_service_exceptions`
- Go query kernel supports:
  - `schedule_snapshot_metadata`
  - route clarification for missing / ambiguous selectors
  - `next_departure`
  - `first_departure`
  - `last_departure`
  - `departure_list`
  - `service_window`
  - `timetable`
  - temporary suspension summaries with `related_notice_refs`
- service-date semantics use Go shell trusted runtime time in `Asia/Shanghai`
- `campus-services-agent` now has `CampusServicesHTTPQueryService` as the
  Python thin adapter for the Go internal query seam
- `supervisor-api` injects the campus-services query service only when
  `SUPERVISOR_STRUCTURED_QUERY_BASE_URL` and
  `SUPERVISOR_STRUCTURED_QUERY_SHARED_SECRET` are configured
- product routing remains gate-closed; this implementation does not by itself
  open `campus_services` serving

## Phase 11 Completed Implementation

- shared `requested_capability` contract now accepts:
  - `knowledge`
  - `place_lookup`
  - `campus_services`
  - `notice`
- Go execution parser maps:
  - `knowledge` / missing capability -> `rag` lane
  - `place_lookup` -> `navigation` lane
  - `campus_services` -> `campus_services` lane
  - `notice` -> `notice` lane
- Go execution parser rejects `requested_scope` and non-current `version_query`
  for non-knowledge capability labels
- supervisor validation accepts explicit `campus_services` / `notice` while
  preserving knowledge-only scope/version semantics
- supervisor routing delegates explicit `campus_services` / `notice` requests to
  corresponding specialist-owned structured runtime payloads
- existing knowledge-path structured runtime candidates remain gate-closed and
  still route through the current `rag-agent` path unless a higher-level surface
  explicitly admits a forward capability

## Phase 12 Completed Implementation

- Go shell exposes internal structured query routes:
  - `POST /internal/query/notices/discover`
  - `POST /internal/query/notices/get`
- notice structured query routes require `x-supervisor-query-auth`
- Go notice runtime consumes `payload + access_context` envelope so restricted
  internal notice authorization is enforced in Go
- Go notice runtime reads `ingestion_projection.internal_notice_read_model`
  through `pgx/v5`
- Go notice get reads canonical markdown bodies from S3-compatible derived bucket
  through AWS SDK v2 S3 client with path-style endpoint support
- `NoticeHTTPQueryService` is now the Python notice-agent thin adapter for the Go
  internal query seam
- Python notice-agent no longer defaults to env-built PG/S3 read-model runtime;
  direct Python PG/S3 notice query code was removed from the active package
- `supervisor-api` injects notice HTTP query service when
  `SUPERVISOR_STRUCTURED_QUERY_BASE_URL` and
  `SUPERVISOR_STRUCTURED_QUERY_SHARED_SECRET` are configured
- product routing remains gate-closed; this implementation does not by itself
  open `notice` serving

## Remaining Implementation

- product-layer cancellation UX belongs to
  `chat-capacity-and-cancellation-hardening`
- provider / prompt executor mid-flight cooperative stop remains future work
- `transport_schedule_lookup` opening gate / eval evidence remains future work
- `campus_notice_discover` / `campus_notice_get` opening gate / eval evidence
  remains future work
- actual environment cutover / rollback drill execution remains environment-side
  rollout work
