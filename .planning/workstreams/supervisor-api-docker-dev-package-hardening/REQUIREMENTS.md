---
doc_type: requirements
status: backlog
created: 2026-04-27
updated: 2026-04-27
---

# Requirements: Supervisor API Docker Dev Package Hardening

## Goal

把 `apps/supervisor-api` 的 Docker/dev 部署包补成可重复、可诊断、可交接的上线前基础包：
operator 可以用稳定命令构建镜像、启动双容器 runtime、运行 preflight/smoke、得到 evidence artifact，
并清楚知道哪些 env/secrets 属于 local dev、staging host、server deployment。

## In Scope

- `apps/supervisor-api` Docker image 的 build/run contract。
- `infra/local/docker-compose.supervisor-runtime.yml` 的 dev/runtime hardening。
- `infra/local/start-supervisor-runtime.sh` 与 `infra/local/smoke-supervisor-runtime.sh`
  的 preflight、profile 与 evidence artifact。
- `scripts.doctor_env supervisor-api` 的部署包 readiness gate。
- supervisor runtime 专属 env inventory / command template。
- README / runbook 中单容器 health smoke 与双容器 execution smoke 的口径修正。
- staging/server handoff 文档，明确 WSL scheduled task 只是当前 staging host 形态。

## Non-Goals

- 不迁移 `supervisor-api` 语言或重写 runtime。
- 不改变 bridge v6 contract、agent handoff schema 或 `packages/contracts`。
- 不打开 product capability gate，也不把 `campus_services` / `notice` 从 gate-closed 改为默认打开。
- 不把 semantic orchestration、retrieval backend、prompt/provider execution 移入 Go shell。
- 不把 deploy secrets 写进 tracked `.env.example` 或 docs 示例中的真实值。
- 不承接 `app-api` Worker deploy、public-chat browser smoke 或 protected-panel smoke。

## Requirements

### `SUP-DEP-01`: Reproducible Docker Artifact

`apps/supervisor-api/Dockerfile` 必须明确：

- build-time Go module proxy / sumdb contract
- runtime artifact path
- embedded runtime policy artifact paths
- non-root user
- health-only single-container limitation

Success criteria:

- `docker build -f apps/supervisor-api/Dockerfile ...` 可复现。
- image 内包含 `intent-policy.v1.json` 与 `query-serving-scopes.v1.json`。
- docs 不把单容器 `docker run` 描述成完整 execution smoke。

### `SUP-DEP-02`: Two-Container Dev Runtime Contract

`supervisor-api + supervisor-agent-worker` 双容器是本地 execution smoke 的 canonical path。

Success criteria:

- compose 启动顺序、bridge URL、bridge secret、query seam env 明确。
- local start script 不要求 operator 手动拼 env。
- README/runbook 中 health-only、readiness、answer smoke 三种口径分开。

### `SUP-DEP-03`: Supervisor API Doctor Gate

`uv run --all-packages python -m scripts.doctor_env supervisor-api --json` 必须覆盖部署包所需最小输入。

Success criteria:

- prompt model/provider、bridge URL/secret、worker timeout、admission budget、request limit、
  structured query secret、structured timeout、shared PG / notice/object-store optionality分类清楚。
- doctor 的 `overall_ready=true` 不应掩盖双容器 execution smoke 缺少 bridge secret / URL 的情况。
- local dev 的 placeholder secret 只能由 local start script 注入，不被描述成 deploy-ready secret。

### `SUP-DEP-04`: Env Ownership And Template

新增或更新 supervisor runtime 专属 env inventory，不污染 root `.env.example`。

Success criteria:

- operator 能区分 repo root shared provider、app-local Worker env、supervisor runtime command env。
- staging/server 必填 secret 与 local default placeholder 分开。
- docs 不展示真实 secret，不要求把 deploy-only key 放入 root `.env.example`。

### `SUP-DEP-05`: Compose Hardening

`infra/local/docker-compose.supervisor-runtime.yml` 必须能作为 local/dev deployment package 的可检查基线。

Success criteria:

- services 有 healthcheck。
- services 有合理 restart/logging/resource/security posture，或文档明确 local-only limitation。
- `depends_on` 不再被误解成 readiness guarantee；smoke 等待 `/readyz`。

### `SUP-DEP-06`: Smoke Evidence Artifact

local smoke 必须能生成稳定 artifact 包。

Success criteria:

- smoke 输出 `.tmp/supervisor-api-local-smoke/<timestamp>/`。
- 至少包含 `healthz.json`、`readyz.json`、`metrics.txt`、`answer.json`、`summary.json` 或等价文件。
- 支持 `closed_gate`、`open_structured`、`readyz_degraded` 等现有 profile。
- 失败时保留诊断证据，不只返回终端日志。

### `SUP-DEP-07`: Staging / Server Handoff

当前 WSL scheduled task + named tunnel 可以保留为 staging host 形态，但必须和通用 server Docker package 分层。

Success criteria:

- runbook 明确当前 staging host lifecycle 与 server handoff 的差异。
- server handoff 说明 port、reverse proxy/tunnel、healthcheck、restart、log retention、resource cap。
- `app-api` 只依赖显式 execution origin URL，不依赖某台 dev host 的隐含状态。

### `SUP-DEP-08`: Verification Commands

部署包必须有稳定、可重复的验证命令。

Success criteria:

- static gates: Go tests/lint、shell lint、docs lint、Dockerfile lint、yaml lint。
- runtime gates: Docker build、local two-container smoke、optional staging status check。
- docs 中命令与实际脚本一致。

## Acceptance Definition

该 workstream 完成时，operator 应能在本地执行一组固定命令完成：

1. supervisor-api Docker image build。
2. 双容器 local runtime 启动。
3. health / ready / metrics / answer smoke。
4. evidence artifact 生成。
5. teardown / rerun。

同时，planning/docs 应清楚说明哪些工作仍属于后续 server/staging live acceptance，而不是本地 dev 包本身。
