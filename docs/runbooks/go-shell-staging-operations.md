---
doc_type: runbook
status: active
created: 2026-04-24
updated: 2026-04-24
---
# Go-Shell Staging Operations

## 文档边界

这份 runbook 只回答当前 canonical staging execution upstream 的长期运维真相：

- 当前 repo-owned staging execution runtime 是 `go-shell + supervisor-orchestrator`
  双容器
- `exec-staging.ayafeed.com` 继续通过 named tunnel 指回这台主机上的本地
  `go-shell` runtime
- `campus-supervisor-api-dev` 只保留为 rollback / fallback 路径

它不覆盖 browser smoke 证据采集；那部分统一看
`go-shell-staging-smoke-runbook.md`。

## 当前真相

- `apps/supervisor-api` 的前向 deploy substrate 已冻结为 Docker-first internal execution
  service
- 当前 repo-owned staging execution runtime：
  - `infra/local/docker-compose.supervisor-runtime.yml`
  - `supervisor-shell`
    - `trusted-worker`
    - `127.0.0.1:27010`
    - `/healthz` `/readyz` `/metrics` `/api/v1/answer`
  - `supervisor-orchestrator`
    - private `/internal/bridge/*`
- named tunnel：
  - tunnel name: `supervisor-api-staging`
  - public hostname: `<https://exec-staging.ayafeed.com`>
  - connector config 必须把该 hostname 指到本机 `http://127.0.0.1:27010`
- shared staging `app-api`：
  - `<https://campus-api-staging.ayafeed.com`>
- 常驻机制：
  - Windows scheduled task: `CampusAgent-GoShellStaging`
  - WSL-side lifecycle scripts: `infra/local/staging/start-go-shell-staging.sh`
  - strict health check: `infra/local/staging/status-go-shell-staging.sh --check`
  - lifecycle lock: `.tmp/go-shell-staging/lifecycle.lock`

## 安装与重装

首次安装或重装计划任务：

```bash
infra/local/staging/install-go-shell-staging-task.sh
```

安装后核对：

```bash
powershell.exe -NoProfile -Command \
  "Get-ScheduledTask -TaskName 'CampusAgent-GoShellStaging' | \
  Format-List TaskName,Description,Triggers,Actions"
```

应看到：

- 任务名为 `CampusAgent-GoShellStaging`
- action 通过 `wsl.exe ... bash -lc` 进入当前 repo
- action 会显式注入：
  - `GO_SHELL_STAGING_PORT=27010`
  - `GO_SHELL_STAGING_TUNNEL_NAME=supervisor-api-staging`
  - `GO_SHELL_STAGING_PUBLIC_BASE_URL=<https://exec-staging.ayafeed.com`>
  - `GO_SHELL_STAGING_APP_API_BASE_URL=<https://campus-api-staging.ayafeed.com`>
- 如果存在 `CampusAgent-DevBackedSupervisorStaging`，安装器会先停掉并 disable 旧任务，保留它作为
  fallback，不再让它与 go-shell runtime 并发运行
- trigger 包含：
  - 登录时执行一次
  - 每 5 分钟重复执行一次

## 日常健康检查

人类可读状态：

```bash
infra/local/staging/status-go-shell-staging.sh
```

严格健康检查：

```bash
infra/local/staging/status-go-shell-staging.sh --check
```

`--check` 通过标准：

- legacy `campus-supervisor-api-dev` 进程不存在
- `supervisor-shell` 与 `supervisor-orchestrator` 都在当前 compose project 中运行
- 如果配置了 public execution origin，则 `cloudflared` 进程存在
- 本地 `<http://127.0.0.1:27010/healthz`> 返回 `200`
- 本地 `<http://127.0.0.1:27010/readyz`> 返回 `200`
- 本地 `<http://127.0.0.1:27010/metrics`> 返回 `200`
- `<https://exec-staging.ayafeed.com/readyz`> 返回 `200`
- `<https://campus-api-staging.ayafeed.com/readyz`> 返回 `200`
- `campus-api-staging` 的 `auth`、`database`、`supervisorApi` 都是 `ready`

计划任务层状态：

```bash
powershell.exe -NoProfile -Command \
  "Get-ScheduledTaskInfo -TaskName 'CampusAgent-GoShellStaging' | \
  Format-List LastRunTime,LastTaskResult,NextRunTime,NumberOfMissedRuns"
```

## 冷启动恢复

当前 canonical 冷启动恢复流程：

```bash
infra/local/staging/stop-go-shell-staging.sh
powershell.exe -NoProfile -Command \
  "Start-ScheduledTask -TaskName 'CampusAgent-GoShellStaging'"
until infra/local/staging/status-go-shell-staging.sh --check; do \
  sleep 2; done
```

说明：

- `Start-ScheduledTask` 会比 WSL 内部 `start-go-shell-staging.sh` 更早返回
- 因此冷启动后第一下 `status --check` 可能只是任务尚未完全拉起；canonical 操作是轮询到 green
- 如果旧的 dev-backed runtime 还在运行，`start-go-shell-staging.sh` 会直接 fail-fast，要求先停掉
  fallback runtime，再启动 canonical runtime

## 日志与轮转

日志目录：

- `.tmp/go-shell-staging/logs/supervisor-shell.log`
- `.tmp/go-shell-staging/logs/supervisor-orchestrator.log`
- `.tmp/go-shell-staging/logs/cloudflared.log`

轮转规则：

- 每次执行 `start-go-shell-staging.sh` 时都会检查日志大小
- 单文件超过 `20 MiB` 时做 copy-truncate 轮转
- 最多保留 `5` 份历史：`.1` 到 `.5`

## 故障分流

`status --check` 报 `legacy campus-supervisor-api-dev process is still running`

- 说明 rollback runtime 还没退出
- 先执行：

```bash
infra/local/staging/stop-dev-backed-supervisor-staging.sh
```

- 然后再重跑 go-shell start / status

`status --check` 报 `go-shell compose project is not fully running`

- 先看：
  - `.tmp/go-shell-staging/logs/supervisor-shell.log`
  - `.tmp/go-shell-staging/logs/supervisor-orchestrator.log`
- 再直接执行：

```bash
cd <repo-root>
COMPOSE_PROJECT_NAME=campus-go-shell-staging \
SUPERVISOR_SHELL_HOST_PORT=27010 \
docker compose -f infra/local/docker-compose.supervisor-runtime.yml ps
```

`status --check` 报 `local readyz returned HTTP ...`

- 说明 shell 或 orchestrator 还没达到真实 runtime ready
- 先跑：

```bash
uv run --all-packages python -m scripts.doctor_env supervisor-api --json
```

- 再看 `supervisor-orchestrator.log` 中缺的是 prompt/runtime 还是 audit/runtime

`status --check` 报 `public readyz returned HTTP ...`

- 优先判断 named tunnel connector 是否掉线
- 用 `cloudflared.log` 确认最近一次 connector 注册是否成功

`status --check` 报 `app-api readyz ...`

- 说明本地 go-shell runtime 可能健康，但 shared staging `app-api` 自身或它到 supervisor 的依赖不健康
- 直接检查：

```bash
curl --noproxy '*' -sS -i https://campus-api-staging.ayafeed.com/readyz
```

- 如果只有 `supervisorApi` 失败，先回到这份 runbook 的冷启动恢复流程

## Fallback

如果当前 canonical go-shell runtime 无法及时恢复，可以临时回退到 legacy compatibility path：

- 运维步骤：`dev-backed-supervisor-staging-operations.md`
- smoke 步骤：`dev-backed-supervisor-staging-smoke-runbook.md`

但这条路径只用于 rollback / fallback，不再是 staging execution 的默认真相。
