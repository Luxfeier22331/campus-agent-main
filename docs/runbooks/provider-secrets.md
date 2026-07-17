---
doc_type: runbook
owner_boundary: docs/runbooks
status: active
---

# 供应商密钥操作

## 边界

本文规定 Ops Web 中供应商密钥的新增、验证、激活、轮换和撤销。Provider 与环境所有权见
`../environment/providers.md`，架构决策见 `../decisions/adr-0064-runtime-config.md`。

固定边界：

- 在线回答使用 execution-control Provider Config 中已验证并激活的完整 role bundle；
- Hindsight 与 eval 使用各自 runtime owner 管理的供应商配置，不复用在线 bundle；
- 顶层 Agent Activity 开始时通过 reader role 解析一次 active bundle，在途调用保留该 revision；
- `dev`、`staging`、`production` 使用独立密钥；只有存在预算、限流或供应商隔离需求时，
  才为不同角色创建更多密钥。

## 新增和激活

1. 确认目标环境和使用角色。
2. 必要时在供应商平台创建该环境的密钥。
3. 在线回答通过 Ops Web 创建 connection/profile，验证后以 `expectedRevision` 原子激活完整
   role bundle；Hindsight 或 eval 则在各自部署流程中更新配置。
4. 在线运行面确认 reader DSN 和版本化 keyring 可用；admin 服务使用独立 admin DSN、read token
   与 command token。
5. keyring 本地文件权限使用 `0600`；Kubernetes Secret 投影使用 `0440`，由 Pod `fsGroup` 授予
   运行时组只读权限。Kubernetes 使用目录挂载，不使用 `subPath`。
6. 运行所属环境检查和受控冒烟测试。

尚未配置任何 active profile 时，Ops Web 自身仍应就绪并允许进入修复页；依赖缺失 role 的 runtime
必须失败关闭。

## 本地开发

1. 启动 execution-control 本地 admin 和 reader 接口，并提供独立 PostgreSQL owner/reader DSN
   与版本化 keyring。
2. 通过 `OPS_WEB_EXECUTION_CONTROL_ADMIN_URL`、read token 和 command token 将 Ops Web 指向该
   admin 接口。
3. 启动 Ops Web 后通过同一页面创建、验证并激活 profile。
4. 确认 execution-control runtime reader 能解析同一 active revision；本地不生成 file
   projection 或兼容 Secret publisher。

只确认文件是否存在、解析了哪个配置所有者以及请求是否成功。不得打印原始密钥。

## Staging 验证

```bash
pnpm exec tsx scripts/deploy/check-worker-secret-presence.ts --env staging --json
```

随后确认：

1. 每个 Worker 应用均为 `ready=true`，且没有 `missing_secrets`；
2. 目标在线 role bundle 已验证并激活；
3. execution-control 只用 reader role 读取 active revision，并能解密对应 key ID；
4. Ops Web 使用独立 read/command token，浏览器不获得该 token 或数据库凭据；
5. Hindsight 与 eval 的独立配置检查通过；
6. 受控冒烟请求成功。

## 轮换

1. 在供应商平台创建新密钥。
2. 在所属 runtime 创建新配置版本并验证；在线 bundle 使用预期 revision 原子激活。
3. Hindsight 与 eval 更新所属部署密钥存储并按其运行手册重启或重新部署。
4. 完成环境检查和冒烟测试。
5. 撤销旧密钥。

疑似泄露时先切换并立即撤销旧密钥，再检查近期日志、构建产物、截图和共享记录。

## 禁止事项

- 不把仓库根 `.env` 当作部署密钥来源；
- 不让 staging 或 production 共用 dev 密钥；
- 不在 issue、PR、聊天记录、日志、截图或 fixture 中记录原始密钥；
- 不从其他 worktree 复制密钥，也不增加跨 worktree 环境文件分发脚本；
- 不让 agent-runtime 绕过 execution-control 的已激活 bundle 直接从环境变量读取在线供应商
  密钥；
- 不把 Hindsight 或 eval provider 塞入在线 bundle。
