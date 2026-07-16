---
doc_type: runbook
owner_boundary: docs/runbooks
status: active
---
# 供应商密钥操作

## 边界

本文只规定供应商密钥的新增、验证、轮换和撤销步骤。供应商与环境所有权见
`../environment/providers.md`，环境文件分层见
`../environment/env-ownership-and-overrides.md`。

固定边界：

- 在线回答、评测和 Hindsight 使用 app-api 中已激活的供应商配置；
- execution-control 与离线运行时读取显式同步的
  `provider_config_projection.v1` 本地产物，不在请求热路径调用 app-api；
- `env/commands/provider-config-seed.env` 只用于创建或更新配置，不是部署配置来源；
- `dev`、`staging`、`production` 使用独立密钥；只有存在预算、限流或供应商隔离需求时，
  才为不同角色创建更多密钥。

## 新增或更新

1. 确认目标环境和使用角色。
2. 必要时在供应商平台创建该环境的密钥。
3. 对在线回答、评测或 Hindsight，在 Operator Console 创建配置版本，完成验证后激活。
4. 运行 `apps/execution-control/scripts/sync-provider-config-projection.ts`，同步本地投影。
5. 确认运行时的 `CAMPUS_PROVIDER_CONFIG_SNAPSHOT_PATH` 或
   `EXECUTION_CONTROL_PROVIDER_CONFIG_SNAPSHOT_PATH` 指向投影文件。
6. 本地文件权限使用 `0600`；Kubernetes Secret 投影使用 `0440`，由 Pod `fsGroup` 授予
   运行时组只读权限。Kubernetes 使用目录挂载，不使用 `subPath`。
7. 运行所属环境检查和受控冒烟测试。

采集或一次性本地命令不使用供应商配置投影时，应把密钥写入所属部署密钥存储或本地密钥
管理器，不得写入仓库根 `.env.example`。

## 本地验证

```bash
pnpm exec tsx scripts/deploy/doctor-env.ts evals --json
```

只确认文件是否存在、解析了哪个配置所有者以及请求是否成功。不得打印原始密钥。

## Staging 验证

```bash
pnpm exec tsx scripts/deploy/check-worker-secret-presence.ts --env staging --json
```

随后确认：

1. 每个 Worker 应用均为 `ready=true`，且没有 `missing_secrets`；
2. 目标供应商配置已验证并激活；
3. execution-control 只读取本地投影；
4. 同步通道使用配置的 app-api 内部地址和共享密钥，不成为运行时请求热路径；
5. 受控冒烟请求成功。

## 轮换

1. 在供应商平台创建新密钥。
2. 创建新的配置版本，验证、激活并同步投影。
3. 对不使用配置投影的运行面，更新所属部署密钥存储并重启或重新部署。
4. 完成环境检查和冒烟测试。
5. 撤销旧密钥。

疑似泄露时先切换并立即撤销旧密钥，再检查近期日志、构建产物、截图和共享记录。

## 禁止事项

- 不把仓库根 `.env` 当作部署密钥来源；
- 不让 staging 或 production 共用 dev 密钥；
- 不在 issue、PR、聊天记录、日志、截图或 fixture 中记录原始密钥；
- 不从其他 worktree 复制密钥，也不增加跨 worktree 环境文件分发脚本；
- 不让 execution-control 或 agent-runtime 绕过已激活配置直接从环境变量读取在线供应商
  密钥。
