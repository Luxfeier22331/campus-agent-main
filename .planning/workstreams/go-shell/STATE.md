---
doc_type: state
status: active
created: 2026-04-23
updated: 2026-04-24
---

# State: go-shell

## Current Status

- status: `active`
- current phase: `Phase 6 closeout`
- current slice: repo-owned environment-side hard-cut scripts/runbooks 已落地；
  剩余仅是实际环境 cutover / rollback drill 执行
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

- repo-local implementation 当前无 blocker。
- repo-owned environment-side hard-cut automation 当前无 blocker。
- `chat-capacity-and-cancellation-hardening` 若后续恢复，会影响
  product-layer stop/cancel UX、request lifecycle 与可能的 cancel endpoint，
  但不阻塞当前 go-shell closeout。

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

## Continuity Notes

- 不把 Go runtime 类型泄漏进 `packages/contracts`。
- 不把 product-layer auth/session/rate-limit/request projection 移入 `supervisor-core`。
- Go shell 应兼容当前 `app-api -> supervisor-api` internal execution contract。
- Python orchestration bridge 是迁移安全阀，不是长期腐烂兼容层；每个保留边界都要有 owner。

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
- Added repo-owned local smoke / cutover / runback runbook at
  `docs/runbooks/go-shell-local-runtime-smoke.md`.
- Confirmed parity against the repo-local Python compatibility entry with the
  same `trusted-worker` request and fixed `trace_id`.
- Added repo-owned staging hard-cut lifecycle scripts under
  `infra/local/staging/go-shell-staging-*`.
- Added repo-owned go-shell staging scheduled-task installer that disables the
  legacy dev-backed task before cutover.
- Added canonical staging runbooks:
  - `docs/runbooks/go-shell-staging-operations.md`
  - `docs/runbooks/go-shell-staging-smoke-runbook.md`
- Demoted `dev-backed-supervisor-staging-*` docs to fallback / rollback truth.

## Remaining Implementation

- repo-local implementation is complete for the current scope
- future work, if reopened, belongs to:
  - actual environment cutover / rollback drill execution
  - later OTel collector / sink fan-out integration
  - product-layer cancellation UX under `chat-capacity-and-cancellation-hardening`
