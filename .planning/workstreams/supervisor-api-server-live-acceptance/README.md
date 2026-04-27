---
doc_type: index
status: active
created: 2026-04-27
updated: 2026-04-27
---

# Workstream: Supervisor API Server Live Acceptance

这是 `supervisor-api-server-live-acceptance` 的 native workstream 入口。

它只承接 `apps/supervisor-api` 在非 WSL Linux host 上的服务侧实机验收：
确认真实服务器 Docker runtime 可以按当前 contract 启动 `supervisor-api +
supervisor-agent-worker` 双服务，完成 health / readiness / metrics / closed-gate answer
smoke，并留下可复查 artifact。

## Current Status

- status: `active`
- current phase: `Phase 0`
- active implementation: no
- target host: Windows SSH alias `ubuntu-43`
- target host facts already observed:
  - OS: `Ubuntu 24.04.4 LTS`
  - Docker: `29.3.0`
  - Docker Compose: `v5.1.0`
  - ports `18080` and `38080` observed free at planning time
- current scope: 服务侧实机验收计划，不是部署方式冻结、不是真实生产接入

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Boundary Notes

- 本 workstream 不在 `ubuntu-43` 上 build 镜像。
- 本 workstream 不把 `ubuntu-43` 定义为长期运行机器。
- 本 workstream 不做生产容量、压测、长期驻留或 autoscaling 验证。
- 本 workstream 不占用或改写服务器现有 `80/443` 入口。
- 本 workstream 不打开 `campus_services` / `notice` product capability gate。
- 本 workstream 不改变 `supervisor-api -> supervisor-agent-worker -> agent -> retrieval-core`
  当前拓扑。
- 本 workstream 不替代 `supervisor-api-docker-dev-package-hardening`；它只补齐那条线留下的
  non-WSL live-only evidence gap。
