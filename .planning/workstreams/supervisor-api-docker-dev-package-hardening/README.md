---
doc_type: index
status: backlog
created: 2026-04-27
updated: 2026-04-27
---

# Workstream: Supervisor API Docker Dev Package Hardening

这是 `supervisor-api-docker-dev-package-hardening` 的 native backlog workstream 入口。
它记录 `apps/supervisor-api` 从“已有 Docker/dev 骨架”走向可重复本地验证、可交接服务器部署包、
可作为 `app-api` 上游 execution origin 的部署硬化线。

## Current Status

- status: `backlog`
- active implementation: no
- current posture: `apps/supervisor-api` 已是 Docker-first internal execution service；
  当前缺口主要在部署包闭环，不在 Go runtime 基本能力
- reopen rule: 只有在准备补齐 `supervisor-api + supervisor-agent-worker` 本地 Docker/dev
  smoke、部署 preflight、compose hardening、env inventory、artifact evidence 或 staging/server
  handoff 时恢复

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Boundary Notes

- 本 workstream 只处理 `apps/supervisor-api` Docker/dev 部署包硬化。
- 本 workstream 不改变 `supervisor-api -> supervisor-agent-worker -> agent -> retrieval-core`
  的当前执行拓扑。
- 本 workstream 不打开 `campus_services` / `notice` product serving gate。
- 本 workstream 不替代 `supervisor-docker-runtime-language-split`；语言迁移、Rust/Go/Python
  职责重分配仍留在独立 backlog。
- 本 workstream 不把 Worker staging secret truth 写回 repo-tracked root `.env.example`。
- 本 workstream 不把 WSL + Windows scheduled task 当作通用 Linux server 部署真相；它可以保留为当前
  staging host 形态，但 server handoff 必须单独说明。
