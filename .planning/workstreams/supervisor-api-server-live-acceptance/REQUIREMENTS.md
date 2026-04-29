---
doc_type: requirements
status: active
created: 2026-04-27
updated: 2026-04-27
---

# Requirements: Supervisor API Server Live Acceptance

## Goal

在 `ubuntu-43` 这台非 WSL Linux host 上完成一次低扰动服务侧实机验收：
使用预构建镜像或镜像导入方式启动 `supervisor-api + supervisor-agent-worker`，
验证 health / readiness / metrics / closed-gate answer 行为，并产出 artifact 作为
`supervisor-api-docker-dev-package-hardening` 后续 live-only evidence。

## In Scope

- `ubuntu-43` host readiness 复核。
- 不含 build 的验收部署材料准备。
- 服务器侧独立目录、独立 compose project、独立端口运行。
- 双容器 runtime health 验证。
- HTTP service smoke：
  - `/healthz`
  - `/readyz`
  - `/metrics`
  - `/api/v1/answer` closed-gate fail-closed
- artifact 留存：
  - `summary.json`
  - `healthz.json`
  - `readyz.json`
  - `metrics.txt`
  - `answer.json`
  - container / compose status snapshot
- 验收后 cleanup 验证。
- workstream state 回写。

## Non-Goals

- 不在 `ubuntu-43` 上 build `supervisor-api` 或 `supervisor-agent-worker` 镜像。
- 不把 `ubuntu-43` 定义为长期运行机器。
- 不做生产容量、压测、长期稳定性或资源上限验证。
- 不改服务器现有 `80/443`、reverse proxy、tunnel 或业务服务。
- 不接入真实 production ingress。
- 不打开 `campus_services` / `notice` serving gate。
- 不验证 `app-api -> supervisor-api` 真实 upstream 联调，除非后续另行 admission。
- 不改变 supervisor runtime 语言边界或 agent handoff contract。

## Requirements

### `SUP-LIVE-01`: Host Readiness Evidence

必须记录 `ubuntu-43` 的 host facts：

- OS / kernel basics
- Docker version
- Docker Compose version
- available memory / swap / disk
- target port availability
- existing container status

Success criteria:

- 证据来自 Windows-side SSH alias `ubuntu-43`，不是 WSL 本机。
- 结论只判断是否足够完成本次服务侧验收，不扩展成长期部署判断。

### `SUP-LIVE-02`: No-Server-Build Deployment Material

验收部署材料必须避免在 `ubuntu-43` 上 build 镜像。

Allowed image sources:

- local/CI prebuilt image exported with `docker save` and transferred to host
- registry pull
- already-present image on host

Success criteria:

- `ubuntu-43` 上执行的是 `docker load` / `docker pull` / `docker compose up`，不是
  `docker build` 或 `compose up --build`。
- compose 文件不包含 `build:` 字段，或执行时明确不会触发 build。

### `SUP-LIVE-03`: Isolated Runtime

验收 runtime 必须隔离于已有业务服务。

Required defaults:

- remote directory: `~/campus-agent-supervisor-acceptance`
- compose project: `campus-supervisor-live-acceptance`
- host bind: `127.0.0.1:38080`
- service port inside compose: `supervisor-api:8000`
- local-only placeholder secrets for smoke

Success criteria:

- 不占用 `80/443`。
- 不依赖现有业务容器。
- 容器 / network name 可识别且可清理。

### `SUP-LIVE-04`: Closed-Gate Service Smoke

必须在 `ubuntu-43` 上验证 closed-gate 行为：

- `/healthz` returns `200`
- `/readyz` returns expected ready status
- `/metrics` returns `200`
- `/api/v1/answer` returns `503` for closed structured runtime gate
- answer body includes `structured_runtime_closed`

Success criteria:

- 结果来自 `ubuntu-43` 的 server runtime。
- `campus_services / notice` 仍保持 gate-closed 默认态。

### `SUP-LIVE-05`: Evidence Artifact

验收必须保留可复查 artifact。

Required artifact fields:

- host alias and hostname
- timestamp
- image source / image ids
- compose project
- bound port
- status codes
- closed-gate answer status
- cleanup result

Success criteria:

- artifact 路径记录在 workstream `STATE.md`。
- artifact 不包含真实 secret。

### `SUP-LIVE-06`: Cleanup And Non-Interference

验收结束必须清理临时 runtime。

Success criteria:

- test containers removed
- test network removed
- target port released
- artifact retained
- no change to existing `80/443` listeners

## Acceptance Definition

该 workstream 完成时，应能证明：

1. `ubuntu-43` 作为非 WSL Linux host 可以运行当前 supervisor 服务包。
2. 双服务 runtime 的 health / ready / metrics / closed-gate answer 行为符合 contract。
3. 验收过程没有触发 server-side image build。
4. 验收过程没有占用现有业务入口或长期驻留服务。
5. 验收 evidence 已落盘并在 `STATE.md` 中记录。
