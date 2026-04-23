---
doc_type: index
status: active
created: 2026-04-23
updated: 2026-04-23
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
- current phase: `Phase 2/3/5 implementation`
- current slice: Python orchestration bridge、auth/admission parity 与 Docker harness
  已落地；后续转向 cancellation、metrics 与 cutover/runback
- origin: 从 `supervisor-docker-runtime-language-split` backlog 中拆出的第一刀执行线

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
