---
doc_type: runbook
status: active
created: 2026-04-02
updated: 2026-04-02
---

# Provider Secret Governance

## Purpose

本 runbook 只定义 provider secret 的 deploy-side 治理与本地/部署分层规则。

它不重新定义：

- repo-shipped Python entrypoint 的本地 bootstrap contract
- `packages/evals` / `packages/shared` 的 provider precedence
- app/runtime topology

这些代码与本地配置语义以 `docs/environment/README.md` 和
`docs/plans/env-bootstrap-and-provider-configuration-governance.md` 为准。

## Core Rules

### Rule 1: local `.env` is not deploy truth

repo root `.env` 只用于当前 worktree 本地开发。

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

默认共享 provider 真相来自：

- `LLM_*`
- `EMBEDDING_*`

只有当 eval 需要独立预算、独立限流或独立 provider 时，才单独下发：

- `EVAL_LLM_*`
- `EVAL_EMBEDDING_*`

不要为了“看起来整齐”而强制拆出独立 eval key。

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
- key owner：开发环境 secret store 或当前 worktree 本地 `.env`
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
2. 确认此次下发的是 shared provider 还是 eval-only override
3. 在对应 deploy secret store 中写入所需键
4. 不要把真实值写回 repo-tracked `.env.example`、README 或 runbook

### Verify local environment

本地只验证当前 worktree：

1. 确认 `.env` 在当前 worktree
2. 运行：
   `uv run --all-packages python -m scripts.doctor_env evals --json`
3. 检查：
   - `bootstrap.file_found=true`
   - `bootstrap.loaded_path` 指向当前 worktree `.env`
   - provider `checked_keys` 顺序符合预期
   - `resolved_key` 符合当前期望
4. 不要通过打印 raw env value 来做验证

### Verify deploy environment

1. 在 deploy 平台确认对应 secret key 已下发
2. 通过受控 smoke / acceptance 入口验证 provider 可用
3. 只记录：
   - secret 是否存在
   - 命中了哪类 key owner
   - 请求是否成功
4. 不要在日志、截图、artifact 中记录 raw key

## Rotate Procedure

1. 在 provider 平台创建新 key
2. 写入目标环境 secret store
3. 重新部署或重启需要加载新 secret 的运行面
4. 执行对应 smoke / acceptance / doctor 检查
5. 确认新 key 工作正常后撤销旧 key

如果是泄露应急：

1. 先创建并切换新 key
2. 立即 revoke 旧 key
3. 复核近期日志、artifact、截图与共享记录
4. 如有必要，追加预算/调用审计

## Do Not

- 不要把 root `.env` 当 deploy secret source
- 不要让 staging / prod 共用 dev key
- 不要把 raw key 发到 issue、PR、chat 记录或测试 fixture
- 不要通过“代码里自动 fallback 到别的 worktree `.env`”解决 deploy 或 staging 问题
