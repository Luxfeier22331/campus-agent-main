---
doc_type: state
status: active
created: 2026-04-23
updated: 2026-04-23
---

# State: go-shell

## Current Status

- status: `active`
- current phase: `Phase 2/3/5 implementation`
- current slice: Python orchestration bridge, auth/admission parity and Docker harness
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
  `log/slog`、`testing` / `httptest`，并通过 OpenTelemetry Go 承接
  traces / metrics。
- 第一版 bridge 使用稳定 JSON over Unix domain socket 或 loopback 调用长驻
  Python orchestration worker，不默认引入 gRPC。
- `app-api` 继续拥有产品层限流；Go shell 只拥有 execution admission /
  backpressure。
- provider-backed prompt executor 和 prompt stack assembly 暂不迁，除非后续
  profiling 证明它们是 Go shell 稳定后的下一条瓶颈线。

## Blockers

- 尚未完成当前 Python `supervisor-api` 行为基线测试清单。
- `chat-capacity-and-cancellation-hardening` 会影响 cancellation、coalescing、
  backpressure 与 request lifecycle contract。

## Verification

- Go check passed on 2026-04-23:

  ```bash
  PATH="/home/reptilian/code/campus-agent/.tmp/go-toolchain/go/bin:$PATH" pnpm go:check
  ```

- `pnpm docker:lint` passed on 2026-04-23.
- Focused markdown lint for `apps/go-shell/README.md` and workstream docs passed
  on 2026-04-23.
- `docker build -f apps/go-shell/Dockerfile -t campus-go-shell:local .` passed on
  2026-04-23.
- Container smoke passed on 2026-04-23:
  - `/healthz` returns `200` with `status=ok`.
  - `/readyz` returns `503` with `status=degraded` while bridge is absent.
  - `/api/v1/answer` returns `503 bridge_not_configured` while bridge is absent.

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
