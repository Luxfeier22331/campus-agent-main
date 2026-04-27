---
doc_type: state
status: completed
created: 2026-04-27
updated: 2026-04-27
---

# State: Supervisor API Docker Dev Package Hardening

## Current Status

- status: `completed`
- current slice: `Phase 0-7` 已执行完成（本地部署包闭环）
- owner: unassigned
- active implementation: no

## Completed Outcomes

- `scripts/doctor_env.py`
  - `supervisor-api` required inputs收紧：bridge base URL + shared secret 必填。
  - 新增条件校验：execution audit / opened `campus_services|notice` 对应依赖必须齐备。
  - text/json 输出都包含 condition 结果。
- `infra/local/docker-compose.supervisor-runtime.yml`
  - 双服务增加 `init`, `restart`, `no-new-privileges`, log rotation, healthcheck。
  - `supervisor-api` 等待 `supervisor-agent-worker: service_healthy`。
  - worker healthcheck 使用 `x-supervisor-bridge-auth`，避免 401 假性 unhealthy。
- `infra/local/smoke-supervisor-runtime.sh`
  - 增加标准 artifact bundle（`healthz/readyz/metrics/answer/summary`）。
  - 失败保留 artifact。
  - 启动失败场景下也会触发 compose 清理（`started_compose` 置位顺序修复）。
- env/docs
  - 新增 `env/commands/supervisor-runtime.env.example`。
  - README/runbook/environment 文档完成命令口径与 owner 边界修正。
  - 新增 `docs/runbooks/supervisor-api-server-handoff.md`。

## Verification Evidence

- passed
  - `pnpm go:check`
  - `pnpm shell:lint`
  - `pnpm docker:lint`
  - `pnpm yaml:lint`
  - `pnpm docs:lint`
  - `uv run --all-packages python -m unittest tests.test_supervisor_api_local_runtime -q`
  - `docker build -f apps/supervisor-api/Dockerfile -t campus-supervisor-api:local .`
  - `infra/local/smoke-supervisor-runtime.sh closed_gate`
- runtime artifact
  - `.tmp/supervisor-api-local-smoke/20260427T145119Z-closed_gate/summary.json`

## Live-Only Gap Closure

- 非 WSL 的服务器实机验收已闭环，执行记录在
  `supervisor-api-server-live-acceptance`：
  - host: `ubuntu-43` (`VM-0-2-ubuntu`)
  - artifact:
    `/home/ubuntu/campus-agent-supervisor-acceptance/bundle/artifacts/20260427T155723Z-closed_gate/summary.json`
  - result:
    - `healthz=200`
    - `readyz=200`
    - `metrics=200`
    - `closed_gate answer=503` with `structured_runtime_closed`

## Continuity Notes

- 与 `supervisor-docker-runtime-language-split` 保持解耦；本线只做部署包硬化，不做语言迁移。
- 继续维持 `campus_services / notice` 默认 gate-closed，除非其他 workstream 显式打开。
- WSL staging 文档继续仅作为 staging-host 生命周期参考，通用服务器以 handoff runbook 为准。
