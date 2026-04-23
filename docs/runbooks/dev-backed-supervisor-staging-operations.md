---
doc_type: runbook
status: active
created: 2026-04-19
updated: 2026-04-24
---
# Dev-Backed Supervisor Staging Operations

## 文档边界

这份 runbook 只回答 legacy dev-backed staging fallback 的运维真相：

- 当前 canonical staging execution runtime 不可用时，如何回退到
  `campus-supervisor-api-dev`
- `exec-staging.ayafeed.com` 通过 named tunnel 指回这台主机上的本地 `supervisor-api`
- 这条姿势现在只作为 rollback / fallback 路径存在

它不覆盖 canonical go-shell 运维；那部分统一看 `go-shell-staging-operations.md`。

## Fallback Truth

- `apps/supervisor-api` 的前向 deploy substrate 已冻结为 Docker-first internal execution
  service
- 当前 canonical staging execution runtime 已是 `go-shell + supervisor-orchestrator`
- 只有在 canonical runtime 无法及时恢复时，才回退到这条 dev-backed 路径
- 本地 `supervisor-api`
  - `uv run --all-packages campus-supervisor-api-dev`
  - `trusted-worker`
  - `127.0.0.1:8081`
- named tunnel
  - tunnel name: `supervisor-api-staging`
  - public hostname: `<https://exec-staging.ayafeed.com`>
- shared staging `app-api`
  - `<https://campus-api-staging.ayafeed.com`>
- 常驻机制
  - Windows scheduled task: `CampusAgent-DevBackedSupervisorStaging`
  - WSL-side lifecycle scripts: `infra/local/staging/*.sh`
  - lifecycle lock: `.tmp/dev-backed-supervisor-staging/lifecycle.lock`

重要限制：

- 当前 runbook 描述的是 fallback host，不是 canonical staging runtime
- 当前计划任务使用 Windows 当前登录用户的 `Interactive` principal
- 这意味着该 Windows 账号必须保持登录，或由 repo 外部机制保证 auto-login
- 本仓库当前不实现“未登录也自启”的第二套 headless 任务模型

## 安装与重装

首次安装或重装计划任务：

```bash
infra/local/staging/install-dev-backed-supervisor-staging-task.sh
```

只有在你明确要执行 rollback / fallback 时才重装这条任务；canonical staging runtime 默认由
`install-go-shell-staging-task.sh` 管理。

安装后核对：

```bash
powershell.exe -NoProfile -Command \
  "Get-ScheduledTask -TaskName 'CampusAgent-DevBackedSupervisorStaging' | \
  Format-List TaskName,Description,Triggers,Actions"
```

应看到：

- 任务名为 `CampusAgent-DevBackedSupervisorStaging`
- action 通过 `wsl.exe ... bash -lc` 进入当前 repo
- action 会显式注入：
  - `DEV_BACKED_SUPERVISOR_TUNNEL_NAME=supervisor-api-staging`
  - `DEV_BACKED_SUPERVISOR_PUBLIC_BASE_URL=<https://exec-staging.ayafeed.com`>
  - `DEV_BACKED_SUPERVISOR_APP_API_BASE_URL=<https://campus-api-staging.ayafeed.
    com`>
- trigger 包含：
  - 登录时执行一次
  - 每 5 分钟重复执行一次

## 日常健康检查

人类可读状态：

```bash
infra/local/staging/status-dev-backed-supervisor-staging.sh
```

严格健康检查：

```bash
infra/local/staging/status-dev-backed-supervisor-staging.sh --check
```

`--check` 通过标准：

- `supervisor-api` 进程存在
- `cloudflared` 进程存在
- 本地 `<http://127.0.0.1:8081/readyz`> 返回 `200`
- `<https://exec-staging.ayafeed.com/readyz`> 返回 `200`
- `<https://campus-api-staging.ayafeed.com/readyz`> 返回 `200`
- `campus-api-staging` 的 `auth`、`database`、`supervisorApi` 都是 `ready`

计划任务层状态：

```bash
powershell.exe -NoProfile -Command \
  "Get-ScheduledTaskInfo -TaskName 'CampusAgent-DevBackedSupervisorStaging' | \
  Format-List LastRunTime,LastTaskResult,NextRunTime,NumberOfMissedRuns"
```

## 冷启动恢复

当前 canonical 冷启动恢复流程：

```bash
infra/local/staging/stop-dev-backed-supervisor-staging.sh
powershell.exe -NoProfile -Command \
  "Start-ScheduledTask -TaskName 'CampusAgent-DevBackedSupervisorStaging'"
until infra/local/staging/status-dev-backed-supervisor-staging.sh --check; do \
  sleep 2; done
```

说明：

- `Start-ScheduledTask` 会比 WSL 内部 `start-dev-backed-supervisor-staging.sh`
  完成得更早返回
- 因此冷启动后第一下 `status --check` 可能只是在任务真正拉起前抢跑；canonical 操作是轮询到
  green，而不是立刻把第一下失败当成回归

如果轮询到超时或持续失败，先不要手工再拉第二套命令；先看日志，再判断是 `supervisor-api`、`cloudflared` 还是 shared
`app-api` 失效。

## 日志与轮转

日志目录：

- `.tmp/dev-backed-supervisor-staging/logs/supervisor-api.log`
- `.tmp/dev-backed-supervisor-staging/logs/cloudflared.log`

轮转规则：

- 每次执行 `start-dev-backed-supervisor-staging.sh` 时都会检查日志大小
- 单文件超过 `20 MiB` 时做 copy-truncate 轮转
- 最多保留 `5` 份历史：`.1` 到 `.5`
- copy-truncate 允许当前已运行进程继续写同一 inode，不要求先停服务

## 故障分流

`status --check` 报 `supervisor-api process is not running`

- 先看 `supervisor-api.log`
- 再确认 `apps/app-api/.dev.vars` 中的 `SUPERVISOR_API_SHARED_SECRET` 仍存在
- 必要时走一次 canonical 冷启动恢复

`status --check` 报 `cloudflared process is not running`

- 先看 `cloudflared.log`
- 再确认 `~/.cloudflared/config.yml` 与 tunnel credential 文件仍存在
- 必要时重装计划任务并重跑冷启动恢复

`status --check` 报 `public readyz returned HTTP ...`

- 优先判断 named tunnel connector 是否掉线
- 用 `cloudflared.log` 确认最近一次 connector 注册是否成功

`status --check` 报 `app-api readyz ...`

- 说明这台开发机的本地 supervisor 可能是健康的，但 shared staging `app-api` 自身或它到 supervisor
  的依赖不健康
- 直接检查：

```bash
curl --noproxy '*' -sS -i https://campus-api-staging.ayafeed.com/readyz
```

- 如果是 `auth` / `database` 失败，按 `staging-worker-deploy-runbook.md` 处理 shared
  app-api lane
- 如果只有 `supervisorApi` 失败，回到这份 runbook 的冷启动恢复流程
