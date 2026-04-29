---
doc_type: requirements
status: active
created: 2026-04-23
updated: 2026-04-24
---

# Requirements: go-shell

## Goal

把 Docker 部署侧 `supervisor-api` 的 execution runtime control plane 迁移到 Go，使高并发 transport、
admission、backpressure、cancel/stream、metrics 与 audit/logging 不再受当前 Python
同步线程壳限制，同时保持 supervisor-led multi-agent 业务语义不变。

## Problem Statement

当前 `apps/supervisor-api` 同时承担：

- HTTP / ASGI transport
- internal caller auth
- request JSON parsing 与 `SupervisorRequest` envelope 解析
- 全局 answer admission semaphore
- prompt runtime readiness 聚合
- audit queue / JSONL writer
- provider prompt executor 装配
- 调用 `packages/supervisor-core` 的同步 orchestration

这导致 Docker 侧容量治理、取消、streaming、metrics 与多实例运行策略都绑定在 Python
线程模型上。预算受限时，继续靠 Python worker / thread 扩容不是长期正确边界。

## Target Boundary

Go `apps/supervisor-api` owns:

- HTTP transport and request dispatch
- internal caller auth
- request size / timeout / body validation
- admission / per-lane budgets / backpressure
- client disconnect, cancellation and streaming lifecycle
- health / readiness / metrics / structured request logs
- audit/logging non-blocking sink
- Python orchestration bridge
- deterministic structured query runtime foundation for projection-backed internal
  services, while keeping domain-agent semantics outside the Go runtime
- Docker image entrypoint and runtime process supervision

Python orchestration owns for now:

- `supervisor-core` routing / policy / handoff / answer assembly
- agent execution semantics
- prompt stack assembly
- provider-backed prompt executor until measured otherwise
- retrieval / notice / navigation query semantics
- campus-services domain-agent semantics, tool selection and answer shaping

## Recorded Migration Conclusion

Migrate to Go first:

- HTTP server / route dispatch
- request body limit, JSON parsing and `invalid_json` handling
- internal caller auth
- trace_id and request lifecycle envelope
- admission / backpressure
- client disconnect / cancellation
- streaming-ready lifecycle
- healthz / readyz / metrics
- runtime structured logs and audit enqueue
- Python orchestration bridge
- gate-closed structured query runtime foundation

Do not migrate in the first wave:

- `supervisor-core` routing / policy / handoff / answer assembly
- `rag-agent` / `notice-agent` / `campus-services-agent` semantics
- prompt stack assembly
- provider-backed prompt executor
- retrieval / Qdrant / Postgres query logic
- thin tool adapters
- `transport_schedule_lookup` business query implementation until schedule
  contract discussion is complete

## Recorded Technology Stack

- Go version: use Go `1.26.x` as the initial target unless repo-wide tooling
  freezes a newer supported Go line before implementation.
- HTTP: use standard library `net/http` and `http.ServeMux`.
- Middleware: compose plain `http.Handler` middleware.
- Cancellation: use standard library `context.Context` from `http.Request`.
- Admission: start with channel semaphore or `golang.org/x/sync/semaphore`.
- Product rate limit: keep user/product-layer rate limiting in `app-api`; Go `apps/supervisor-api`
  only owns execution admission and backpressure.
- Logging: use standard library `log/slog` with JSON output.
- Metrics / observability for the current slice: expose `supervisor-api`-owned
  Prometheus-style `/metrics` plus structured request logs; OTel collector or
  sink fan-out stays deferred until a later reopen.
- Bridge: first version uses private loopback HTTP/JSON to a long-running Python
  orchestration worker.
- Tests: use standard library `testing` and `httptest` first.
- Docker base: prefer Debian slim while Python orchestration remains in the same
  deploy shape; revisit distroless only after Go `apps/supervisor-api` can run independently.

The first-wave bridge is not gRPC. The current repo contract is JSON/dataclass
oriented, so gRPC/protobuf should only be reconsidered after runtime cutover if
there is a measured cross-process contract or streaming need.

## External References

- Go release history: <https://go.dev/doc/devel/release>
- Go 1.26 announcement: <https://go.dev/blog/go1.26>
- Go container-aware `GOMAXPROCS`: <https://go.dev/blog/container-aware-gomaxprocs>
- Go `net/http`: <https://pkg.go.dev/net/http>
- Go `context`: <https://pkg.go.dev/context>

## In Scope

- Go module / service skeleton for Docker-side `supervisor-api` execution runtime
- Stable Go-to-Python orchestration bridge contract
- Compatibility with current `POST /api/v1/answer`, `GET /healthz`, `GET /readyz`
- Trusted internal caller auth parity with current `bearer` / `trusted-worker` modes
- Admission parity plus forward lane-budget shape
- Cooperative cancellation and future streaming-ready response lifecycle
- Structured observability, audit, readiness and saturation signals
- Docker packaging, local dev harness and cutover/runback runbook

## Non-goals

- Rewriting Worker-side `apps/app-api`
- Rewriting `packages/supervisor-core`
- Rewriting agents in Go
- Replacing retrieval backend or ingestion/data-plane logic
- Introducing a long synchronous queue inside `supervisor-api`
- Changing `packages/contracts` to expose Go runtime types
- Solving Rust CPU kernel migration in this workstream

## Success Criteria

1. Go `apps/supervisor-api` can serve the existing internal execution HTTP contract without changing
   `app-api` product semantics.
2. Python orchestration can be invoked through a stable bridge with trace_id,
   actor/context, requested capability/scope and version query preserved.
3. Go `apps/supervisor-api` owns admission/backpressure and returns typed saturation errors before
   invoking Python.
4. Cancellation and client disconnect semantics are explicit, even when Python
   can only cooperate at defined boundaries in the first release.
5. `healthz` / `readyz` / metrics plus structured request logs expose transport,
   admission, bridge, prompt runtime and audit status clearly.
6. Docker packaging can run locally and in the intended internal deployment substrate.
7. Existing Python tests remain valid for orchestration semantics, and Go tests
   cover `apps/supervisor-api` runtime behavior.
8. Hardcut removes the active Python public `supervisor-api` entry; rollback/runback,
   if needed, is environment-side and must not reintroduce active repo truth for the old entry.
