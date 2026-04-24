---
doc_type: index
status: active
created: 2026-04-23
updated: 2026-04-24
---

# Workstream: go-shell

`go-shell` 是 Docker 侧 `supervisor-api` execution runtime 的 Go 迁移线短名。

它负责把旧 Python `apps/supervisor-api` 中的 transport/runtime control-plane 能力迁到
Go，同时保留现有 Python `supervisor-core` / specialist agents orchestration 语义。

当前 hardcut 后的实现位于：

- Go execution ingress: `apps/supervisor-api`
- Python private bridge worker: `apps/supervisor-core-worker`

已落地的 runtime 能力包括：

- Go `net/http` execution runtime
- `/healthz`、`/readyz`、`/api/v1/answer` transport surface
- request body limit、JSON object 校验、`bearer` / `trusted-worker` auth
- global admission semaphore 与 bridge fail-closed 行为
- `SupervisorRequest -> SupervisorResponse` private HTTP bridge
- Go `supervisor-api` / Python `supervisor-core-worker` 双容器本地 Docker harness
- Dockerfile 与 root `pnpm go:check` / CI lint lane

## Current Status

- status: `active`
- current phase: `Phase 19 closeout`
- current slice: Go `supervisor-api` 已承接 service-status fail-close hardening、
  execution audit batching/retry/spool、OTel sample/export/drop/failure accounting，
  以及 `/api/v1/answer/stream` lifecycle SSE seam。`campus_services` / `notice`
  structured query runtime kernels 仍保持产品 serving gate closed
- origin: 从 `supervisor-docker-runtime-language-split` backlog 中拆出的第一刀执行线

## Completed So Far

- `Phase 1`
  - Go `net/http` runtime、Docker image、repo-owned compose harness、`pnpm go:check`
- `Phase 2`
  - `SupervisorRequest -> SupervisorResponse` private HTTP bridge
  - Python bridge worker routes 与 Docker worker image
  - repo-local two-container smoke
- `Phase 3`
  - `bearer` / `trusted-worker` auth parity
  - request body limit、strict JSON object validation、global admission semaphore
  - Go `/readyz` 聚合 Python worker readiness
- `Phase 4`
  - client disconnect / timeout cancellation semantics 已显式化并补测试
  - 明确当前不提供独立 cancel endpoint，也不承诺 Python mid-flight cooperative cancel
- `Phase 5`
  - `/metrics`、bridge failure counters、answer-path structured logs 已落地
  - `/readyz` 已暴露 bridge answer success / failure fingerprint
- `Phase 6`
  - repo-local compose smoke 已重跑
  - Python compatibility entry parity rerun 已通过
  - cutover / runback runbook 已落地
  - canonical staging hard-cut lifecycle scripts / task installer / runbooks 已落地
- `Phase 7`
  - request lifecycle registry、explicit cancel、per-lane admission、OTel seam 已落地
  - execution audit events 以 best-effort 方式回流 `app-api` internal
    ingest，不阻塞 answer path
- `Phase 8`
  - Go cancel endpoint 已向 Python private bridge 投递 cooperative cancel signal
  - Python bridge 已记录 active request id 的 cancel state
- `Phase 9`
  - Go `apps/supervisor-api` 已提供 gate-closed structured query runtime foundation
  - `service_status_lookup` 可读 file projection fixture
  - `transport_schedule_lookup` 初始只返回 typed fail-closed seam，已由
    `Phase 10` supersede
- `Phase 10`
  - `transport_schedule_lookup` 可读 schedule snapshot / route / departure /
    exception projection
  - 支持 snapshot metadata、route clarification、first / next / last departure、
    departure list、service window、timetable 与 temporary suspension summary
  - Python `campus-services-agent` 已具备 HTTP thin adapter，`supervisor-api`
    仅在配置 structured query base URL / secret 时注入该 query service
- `Phase 11`
  - `requested_capability` wire label 扩展到 `campus_services` / `notice`
  - Go execution parser 将 forward capability 映射到对应 lane admission
  - supervisor validation 明确 `requested_scope` / `version_query` 只属于
    knowledge path
  - explicit forward capability 可进入对应 specialist-owned structured runtime
    handoff；knowledge path gate-closed 行为不变
- `Phase 12`
  - Go `supervisor-api` 已提供 `/internal/query/notices/discover` 与
    `/internal/query/notices/get`
  - Go `supervisor-api` 读取 `ingestion_projection.internal_notice_read_model` 与
    S3-compatible derived canonical markdown body
  - Python `notice-agent` 已切到 HTTP thin adapter；Python 侧 PG/S3 default runtime
    已从 active package 移除
  - `supervisor-api` 在 configured structured query base URL / secret 时注入
    notice HTTP query service
- `Phase 13`
  - Python bridge cancel registry 已接入 supervisor orchestration checkpoints
  - cancelled bridge terminal response 以 `499 execution_cancelled` 回到 Go
  - Go lifecycle final state 可记录为 `canceled`
- `Phase 14`
  - Go bridge circuit breaker 已保护 Python bridge transport / protocol failure
  - `/readyz` 和 `/metrics` 已暴露 circuit state / open / reject 计数
- `Phase 15`
  - execution audit failure/cancel events 已贯穿 measured bridge duration 与
    queue wait summary
- `Phase 16`
  - `service_status_lookup` 对 expired effective window 与 incomplete current
    records fail-close，不再把历史/缺字段记录返回为 `resolved_current`
- `Phase 17`
  - execution audit writer 支持 batch、flush、retry 与 optional local spool；
    delivery 继续 fail-open，不阻塞 answer path
- `Phase 18`
  - OTel runtime 支持 deterministic sample ratio、allowlisted runtime attributes、
    exported / dropped / failed counters，并在 `/readyz` / `/metrics` 暴露
- `Phase 19`
  - Go `supervisor-api` 提供 `/api/v1/answer/stream` lifecycle SSE endpoint；
    `app-api` supervisor adapter 提供 optional stream method 透传 SSE body，不做
    token delta 解析

## Remaining Work

- repo 内当前没有 Phase 8-19 的剩余必做实现项
- `transport_schedule_lookup` 的 runtime kernel 已实现；opening gate 仍需 eval /
  regression evidence 与产品路由 admission 决策
- `campus_notice_discover` / `campus_notice_get` 的 runtime kernel 已实现；opening
  gate 仍需 eval / regression evidence 与产品路由 admission 决策
- product-layer cancellation UX 继续属于 `chat-capacity-and-cancellation-hardening`
- provider / prompt HTTP call 已经 mid-flight 时仍不做 hard-abort；当前只保证
  deterministic orchestration checkpoints 观测 cancel
- 实际环境 cutover / rollback drill 执行属于 environment-side rollout，不阻塞
  repo-local closeout

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Boundary Notes

- 不涉及 Worker 侧 `app-api` / web surfaces 选型
- 不重写 `packages/supervisor-core` 的 routing / policy / handoff / answer assembly
- 不重写 `packages/rag-agent`、`packages/notice-agent`、`packages/campus-services-agent`
  或 `packages/navigation-agent`
- 不默认 Rust 化 tool；Rust CPU kernel 仍属于更宽的 runtime language split backlog
- Go `supervisor-api` 首先承接 HTTP transport、auth、admission、backpressure、cancel/stream、
  readiness/metrics、audit/logging 与 Python orchestration bridge
- Go structured query runtime 只承接 projection-backed deterministic query service
  seam；domain-agent 语义、tool selection 与 answer shaping 不迁入 Go `apps/supervisor-api`

## Recorded Conclusion

`go-shell` 的第一轮迁移结论是：迁 runtime control plane，不迁业务 agent。

Go 侧优先使用标准库和少量官方生态组件。第一版不引入 Gin / Echo / Fiber，也不引入
gRPC 作为默认 bridge；Go `supervisor-api` 通过稳定 JSON bridge 调用长驻 Python
`supervisor-core-worker`。

## Related Workstreams

- `chat-capacity-and-cancellation-hardening`
  - 提供 public chat 重复提交、中止体验、热点削峰与 capacity gate 的产品侧需求
- `supervisor-docker-runtime-language-split`
  - 保留 Go / Rust / Python 的总体 runtime split 评估
- `repo-wide-agent-harness-rollout`
  - 提供 workstream harness、result artifact 与执行入口约束
