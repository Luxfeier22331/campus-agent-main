---
doc_type: runbook
truth_scope: ops
owner_boundary: docs/runbooks
status: active
created: 2026-04-02
updated: 2026-04-12
---
# Provider Secret Governance

## Purpose

本 runbook 只定义 provider secret 的 deploy-side 治理与本地/部署分层规则。

它不重新定义：

- repo-shipped Python entrypoint 的本地 bootstrap contract
- `packages/evals` / `packages/shared` 的 provider precedence
- app/runtime topology

这些代码与本地配置语义以 `docs/environment/README.md` 为准。

当前 online answer path 的 provider/model/API key 不再以 root `.env` 或 deploy
env 为运行时真相。
prompt 与 embedding provider profile 由 `apps/app-api` 持久化，Operator Console
`/operations/provider-config` 修改，`execution-control` 通过 internal active
snapshot 消费。
本 runbook 仍负责环境隔离、key 获取、rotate 与不泄露规则。

## Core Rules

### Rule 1: local `.env` is not deploy truth

repo root `.env` 只用于本地工作区开发。

它不是：

- staging deploy truth
- production deploy truth
- 团队共享 secret registry

### Rule 2: deploy environments must use separate provider keys

至少固定三套环境：

- `dev`
- `staging`
- `prod`

每个环境必须使用独立 provider key。

如果 provider 是 OpenAI，长期上优先使用不同 Project 的 API keys，而不是让多个环境共用同一把 key。

### Rule 3: eval override remains explicit

eval / local command 默认共享 provider 真相来自：

- app-api provider-config active profiles
- 显式同步生成的本地 `provider_config_projection.v1` artifact

online serving 的 active provider truth 来自 app-api provider-config profile：

- prompt roles: `primary_agent`、`rag_synthesis`
- embedding roles: `rag_query_embedding`
- `index_embedding` 只服务 offline indexing / rebuild 语义

eval provider truth 同样来自 app-api provider-config profile：

- prompt roles: `eval_ragas_llm`、`eval_judge_llm`
- embedding role: `eval_ragas_embedding`

只有当 eval 需要独立预算、独立限流或独立 provider 时，才给这些 roles 绑定独立
connection。不要为了“看起来整齐”而强制拆出独立 eval key。

### Rule 4: rotate and revoke are normal operations

出现以下任一情况时，应触发 rotate：

- 人员变更
- deploy secret store 泄露怀疑
- 日志或截图疑似暴露 key
- provider 平台告警异常调用
- 环境隔离策略调整

不要把 rotate 视为异常大事件；它是正常运维动作。

## Environment Matrix

### dev

- 目标：本地开发、受控 smoke、低风险 bench
- key owner：开发环境 secret store 或本地工作区 `.env`
- 预算：最低
- 允许使用独立 eval override：视需要

### staging

- 目标：预发布验证、受控 acceptance、deploy smoke
- key owner：staging secret store
- 预算：中等
- 不允许回退到开发机本地 `.env`

### prod

- 目标：真实用户流量
- key owner：production secret store
- 预算：按正式服务治理
- 不允许与 dev/staging 共用 key

## Operational Checklist

### Add or update secrets

1. 确认目标环境是 `dev`、`staging` 还是 `prod`
1. 确认此次修改是 online serving provider profile，还是 eval / ingestion /
   local command env
1. online serving 修改：在 Operator Console 创建或更新 profile，validate 后 activate；
   profile list 不返回 raw key，只显示 masked metadata
1. eval / ingestion / local command 修改：在对应 deploy secret store 中写入所需键
1. 不要把真实值写回 repo-tracked `.env.example`、README 或 runbook

### Verify local environment

本地只验证当前工作区：

1. 确认 `.env` 在当前工作区
1. 运行： `uv run --all-packages python -m scripts.doctor_env evals --json`
1. 检查：
   - `bootstrap.file_found=true`
   - `bootstrap.loaded_path` 指向当前工作区 `.env`
   - provider `checked_keys` 顺序符合预期
   - `resolved_key` 符合当前期望
1. 不要通过打印 raw env value 来做验证

### Verify deploy environment

1. 先运行： `uv run --all-packages python -m scripts.check_worker_secret_presence
   --env staging --json`
1. 确认输出里每个 Worker app 都是 `ready=true`，且没有 `missing_secrets`
1. 再在 Operator Console 确认目标 provider profiles 已 validate + active
1. 运行 `scripts/sync-provider-config-projection.mjs`，确认目标 runtime 的
   `CAMPUS_PROVIDER_CONFIG_SNAPSHOT_PATH` /
   `EXECUTION_CONTROL_PROVIDER_CONFIG_SNAPSHOT_PATH` 指向 0600 projection artifact
1. 对 execution-control 确认它只读取本地 projection artifact；
   `EXECUTION_CONTROL_APP_API_INTERNAL_BASE_URL` 与
   `EXECUTION_CONTROL_APP_API_INTERNAL_SHARED_SECRET` 只用于 control-plane sync /
   activation compatibility，不作为 provider runtime 热路径
1. 再通过受控 smoke / acceptance 入口验证 provider 可用
1. 只记录：
   - secret 是否存在
   - 命中了哪类 key owner
   - 请求是否成功
1. 不要在日志、截图、artifact 中记录 raw key

## Rotate Procedure

1. 在 provider 平台创建新 key
1. 对 online serving / eval / Hindsight：在 Operator Console 创建新 profile revision，
   validate 后 activate，再同步新的 provider projection artifact
1. 对 ingestion / local command：写入目标环境 secret store，并重新部署或重启需要加载新 secret 的运行面
1. 执行对应 smoke / acceptance / doctor 检查
1. 确认新 key 工作正常后撤销旧 key

如果是泄露应急：

1. 先创建并切换新 key
1. 立即 revoke 旧 key
1. 复核近期日志、artifact、截图与共享记录
1. 如有必要，追加预算/调用审计

## Do Not

- 不要把 root `.env` 当 deploy secret source
- 不要让 staging / prod 共用 dev key
- 不要把 raw key 发到 issue、PR、chat 记录或测试 fixture
- 不要通过“代码里自动 fallback 到别的 worktree `.env`”解决 deploy 或 staging 问题
- 不要让 execution-control / agent-runtime 直接从 env 读取 online serving provider API
  key 绕过 app-api active profile
