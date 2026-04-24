---
doc_type: index
status: active
created: 2026-04-23
updated: 2026-04-24
---

# Workstream: go-shell

`go-shell` 是 Docker 侧 `supervisor-api` execution shell 的 Go 迁移线。

它负责把当前 Python `apps/supervisor-api` 中的 transport/runtime shell 能力逐步迁到
Go，同时保留现有 Python `supervisor-core` / specialist agents orchestration 语义。

已落地的第一刀实现位于 `apps/go-shell`：

- Go `net/http` execution shell
- `/healthz`、`/readyz`、`/api/v1/answer` transport surface
- request body limit、JSON object 校验、`bearer` / `trusted-worker` auth
- global admission semaphore 与 bridge fail-closed 行为
- `SupervisorRequest -> SupervisorResponse` private HTTP bridge
- Go shell / Python orchestration 双容器本地 Docker harness
- Dockerfile 与 root `pnpm go:check` / CI lint lane

## Current Status

- status: `active`
- current phase: `Phase 9 closeout`
- current slice: Go shell 已补齐 Python cooperative cancel bridge 与 gate-closed
  structured query runtime foundation；`transport_schedule_lookup` 业务查询仍待 schedule
  contract 讨论后进入后续 phase
- origin: 从 `supervisor-docker-runtime-language-split` backlog 中拆出的第一刀执行线

## Completed So Far

- `Phase 1`
  - Go `net/http` shell、Docker image、repo-owned compose harness、`pnpm go:check`
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
  - Go shell 已提供 gate-closed structured query runtime foundation
  - `service_status_lookup` 可读 file projection fixture
  - `transport_schedule_lookup` 仅返回 typed fail-closed seam

## Remaining Work

- repo 内当前没有 Phase 8-9 的剩余必做实现项
- `transport_schedule_lookup` 的业务查询实现需要先完成 schedule contract 讨论
- product-layer cancellation UX 继续属于 `chat-capacity-and-cancellation-hardening`
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
- Go shell 首先承接 HTTP transport、auth、admission、backpressure、cancel/stream、
  readiness/metrics、audit/logging 与 Python orchestration bridge
- Go structured query runtime 只承接 projection-backed deterministic query service
  seam；domain-agent 语义、tool selection 与 answer shaping 不迁入 Go shell

## Recorded Conclusion

`go-shell` 的第一轮迁移结论是：迁 runtime shell，不迁业务 agent。

Go 侧优先使用标准库和少量官方生态组件。第一版不引入 Gin / Echo / Fiber，也不引入
gRPC 作为默认 bridge；Go shell 通过稳定 JSON bridge 调用长驻 Python orchestration。

## Related Workstreams

- `chat-capacity-and-cancellation-hardening`
  - 提供 public chat 重复提交、中止体验、热点削峰与 capacity gate 的产品侧需求
- `supervisor-docker-runtime-language-split`
  - 保留 Go / Rust / Python 的总体 runtime split 评估
- `repo-wide-agent-harness-rollout`
  - 提供 workstream harness、result artifact 与执行入口约束
