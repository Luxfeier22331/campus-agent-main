---
doc_type: roadmap
status: backlog
created: 2026-04-27
updated: 2026-04-27
---

# Roadmap: Supervisor API Docker Dev Package Hardening

当前为 detailed backlog plan，不代表 active execution order。恢复为 active workstream 前，应确认当前目标是
local/dev package closeout、staging host closeout，还是 server handoff package。

## Phase 0: Package Truth And Gap Baseline

**Goal:** 固定当前已有能力和真实缺口，避免把部署包硬化误扩成 runtime rewrite。

**Inputs:**

- `apps/supervisor-api/Dockerfile`
- `infra/local/docker-compose.supervisor-runtime.yml`
- `infra/local/start-supervisor-runtime.sh`
- `infra/local/smoke-supervisor-runtime.sh`
- `docs/runbooks/supervisor-api-local-runtime-smoke.md`
- `docs/runbooks/supervisor-api-staging-operations.md`
- `scripts/doctor_env.py`

**Scope:**

- 确认 Dockerfile、compose、local smoke、staging lifecycle 的现状。
- 记录 health-only single-container smoke 与 full execution smoke 的差异。
- 记录 doctor gate 现有 required / optional 分类缺口。
- 记录 compose 缺 healthcheck/resource/logging/security posture 的事实。

**Deliverables:**

- `STATE.md` 更新 baseline。
- README/runbook 增补 corrected package truth note。

**Verification:**

```bash
pnpm docs:lint
```

**Exit Criteria:**

- 文档不再把 `docker run supervisor-api` 单容器当作完整 execution smoke。
- 每个后续 phase 都能追溯到 `SUP-DEP-*` requirement。

## Phase 1: Supervisor API Doctor Gate Hardening

**Goal:** 让 `doctor_env supervisor-api` 反映双容器 execution runtime 的最小 deploy readiness。

**Scope:**

- 调整 `scripts/doctor_env.py` 的 `supervisor-api` surface：
  - required：prompt model/provider、bridge base URL、bridge shared secret、request timeout、
    worker timeout、transport admission basics
  - conditional：execution audit enabled 后要求 URL/secret
  - conditional：opened `campus_services` / `notice` 后要求 structured query secret、shared PG、
    notice object-store/read-model inputs
  - optional：metrics token、OTel、spool dir、fine-grained lane overrides
- 增加测试覆盖 required / optional / conditional cases。
- 保持 local script 注入 placeholder 的行为仅限 local dev，不让 doctor 把 placeholder 当作 staging/server secret。

**Primary Write Set:**

- `scripts/doctor_env.py`
- `tests/test_doctor_env.py`
- `docs/environment/deploy-and-eval-readiness.md`
- `docs/runbooks/supervisor-api-local-runtime-smoke.md`

**Verification:**

```bash
uv run --all-packages python -m unittest tests.test_doctor_env -q
uv run --all-packages ruff check scripts/doctor_env.py tests/test_doctor_env.py
uv run --all-packages ruff format scripts/doctor_env.py tests/test_doctor_env.py --check
pnpm docs:lint
```

**Exit Criteria:**

- Missing bridge URL/secret no longer hides behind `overall_ready=true` for deploy readiness.
- Conditional dependencies are tied to feature flags instead of always requiring closed-gate surfaces.

## Phase 2: Compose Runtime Hardening

**Goal:** 把 local two-container compose 变成可检查的 dev deployment package。

**Scope:**

- 为 `supervisor-api` 和 `supervisor-agent-worker` 增加 healthcheck。
- 补充 restart/logging/resource/security posture：
  - local/dev 合理默认
  - server handoff 推荐值
  - 明确哪些 compose 字段仅作本地 baseline
- 确认 `depends_on` 不替代 readiness；smoke 继续等待 `/readyz`。
- 保持 `host.docker.internal` rewrite 仅服务本地 Docker。

**Primary Write Set:**

- `infra/local/docker-compose.supervisor-runtime.yml`
- `infra/local/start-supervisor-runtime.sh`
- `tests/test_supervisor_api_local_runtime.py`
- `docs/runbooks/supervisor-api-local-runtime-smoke.md`

**Verification:**

```bash
pnpm yaml:lint
pnpm shell:lint
uv run --all-packages python -m unittest tests.test_supervisor_api_local_runtime -q
pnpm docs:lint
```

**Exit Criteria:**

- compose 自身暴露 health status。
- local package 有明确 resource/logging posture，不依赖 operator 临场补配置。

## Phase 3: Env Inventory And Command Template

**Goal:** 给 supervisor runtime 独立 env ownership，避免 root `.env.example` 继续承载部署细节。

**Scope:**

- 新增 supervisor runtime command-scoped env template，例如：
  - `env/commands/supervisor-runtime.env.example`
- 分类 env：
  - local dev defaults
  - staging/server required secrets
  - prompt/provider shared values
  - structured query closed-gate optional values
  - observability/audit optional values
- 更新 env ownership docs。
- 确认 `.env.example` 不新增 deploy-only supervisor secret。

**Primary Write Set:**

- `env/commands/supervisor-runtime.env.example`
- `docs/environment/env-ownership-and-overrides.md`
- `docs/environment/provider-and-secret-inventory.md`
- `docs/runbooks/supervisor-api-local-runtime-smoke.md`
- `tests/` env/template guard tests if local pattern exists

**Verification:**

```bash
pnpm env:lint
pnpm docs:lint
uv run --all-packages ruff check scripts tests
```

**Exit Criteria:**

- operator 能从一个 supervisor 专属模板知道部署包需要哪些 env。
- root `.env.example` 不被部署包细节污染。

## Phase 4: Local Smoke Evidence Artifact

**Goal:** 让 local smoke 产出可保存、可复查的 evidence package。

**Scope:**

- 扩展 `infra/local/smoke-supervisor-runtime.sh`：
  - `SUPERVISOR_RUNTIME_SMOKE_ARTIFACT_DIR`
  - timestamped default artifact dir
  - 保存 `healthz` / `readyz` / `metrics` / answer body / summary
  - 失败时保留 artifact
- 支持现有 profiles：
  - `closed_gate`
  - `bridge_semantic`
  - `open_structured`
  - `readyz_degraded`
- summary 中记录：
  - profile
  - base URL
  - status codes
  - selected target / outcome / error code where available
  - whether compose was started by the script

**Primary Write Set:**

- `infra/local/smoke-supervisor-runtime.sh`
- `tests/test_supervisor_api_local_runtime.py`
- `docs/runbooks/supervisor-api-local-runtime-smoke.md`

**Verification:**

```bash
bash -n infra/local/smoke-supervisor-runtime.sh
pnpm shell:lint
uv run --all-packages python -m unittest tests.test_supervisor_api_local_runtime -q
pnpm docs:lint
```

Runtime verification when Docker is available:

```bash
infra/local/smoke-supervisor-runtime.sh closed_gate
```

**Exit Criteria:**

- smoke artifact 可以作为 local deployment evidence。
- 失败排查不依赖滚动终端输出。

## Phase 5: README And Runbook Command Correction

**Goal:** 修正文档命令口径，把 health smoke、readiness smoke、execution smoke 分层。

**Scope:**

- `apps/supervisor-api/README.md`：
  - 单容器 `docker run` 只标记为 health-only。
  - canonical execution smoke 指向 `infra/local/smoke-supervisor-runtime.sh`。
  - build / run / smoke / teardown 命令和实际脚本一致。
- `docs/runbooks/supervisor-api-local-runtime-smoke.md`：
  - 增加 evidence artifact 说明。
  - 增加 doctor gate 前置。
  - 明确 placeholder secret 的 local-only 边界。
- `docs/runbooks/supervisor-api-staging-operations.md`：
  - 明确当前 WSL scheduled task 是 staging host lifecycle，不是通用 Linux server package。

**Primary Write Set:**

- `apps/supervisor-api/README.md`
- `docs/runbooks/supervisor-api-local-runtime-smoke.md`
- `docs/runbooks/supervisor-api-staging-operations.md`
- `docs/environment/deploy-and-eval-readiness.md`

**Verification:**

```bash
pnpm docs:lint
```

**Exit Criteria:**

- 新人按 README 不会误把单容器 health check 当成完整部署验证。
- local/staging/server 责任边界清楚。

## Phase 6: Server Handoff Package

**Goal:** 给未来 Linux server / VM 部署提供可执行 handoff，而不是复用 WSL staging host 假设。

**Scope:**

- 记录 server package contract：
  - Docker compose command
  - env file path
  - port / reverse proxy / tunnel ingress
  - restart policy
  - healthcheck endpoint
  - metrics protection
  - log retention
  - CPU/memory budget
- 明确与 `app-api` 的 execution origin contract：
  - `STAGING_SUPERVISOR_API_BASE_URL` / future production equivalent
  - shared secret owner
  - fail-closed behavior
- 不强行引入 Kubernetes/systemd；只给 Docker-first server baseline。

**Primary Write Set:**

- `docs/runbooks/supervisor-api-server-handoff.md` or equivalent section
- `docs/environment/deploy-and-eval-readiness.md`
- `infra/local/` sample compose override if needed

**Verification:**

```bash
pnpm docs:lint
pnpm yaml:lint
```

**Exit Criteria:**

- server operator 不需要阅读 WSL scheduled task 文档才能部署。
- `app-api` upstream URL / secret / readiness 依赖明确。

## Phase 7: Deployment Package Acceptance

**Goal:** 用固定 gates 验收部署包，而不是靠口头判断“能跑”。

**Scope:**

- Static acceptance:
  - Go check
  - shell lint
  - docker lint
  - yaml lint
  - docs lint
- Runtime acceptance:
  - Docker build
  - local two-container smoke
  - smoke artifact review
  - optional staging status check if target host available
- Acceptance summary：
  - passed commands
  - artifact paths
  - known waivers
  - remaining live-only gaps

**Verification:**

```bash
pnpm go:check
pnpm shell:lint
pnpm docker:lint
pnpm yaml:lint
pnpm docs:lint
docker build -f apps/supervisor-api/Dockerfile -t campus-supervisor-api:local .
infra/local/smoke-supervisor-runtime.sh closed_gate
```

**Exit Criteria:**

- A fresh local operator can reproduce the package acceptance.
- Any remaining staging/server live evidence is explicitly listed, not hidden inside local dev success.

## Dependency Order

- Phase 0 must complete first.
- Phase 1 should precede server/staging acceptance because it defines readiness truth.
- Phase 2 and Phase 3 can run in parallel if write sets are separated.
- Phase 4 depends on the compose/runtime shape being stable enough to produce meaningful artifacts.
- Phase 5 depends on Phase 1-4 decisions.
- Phase 6 depends on Phase 2/3 and can begin before Phase 4 if docs-only.
- Phase 7 is final acceptance and should not introduce new behavior.
