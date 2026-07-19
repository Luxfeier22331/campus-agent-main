---
doc_type: runbook
owner_boundary: docs/runbooks
status: active
---

# 供应商密钥操作

## 边界

本文规定在线 Provider Config 中供应商密钥的新增、验证、激活、轮换和撤销。Provider 与环境
所有权见 `../environment/providers.md`，接口边界见 `../contracts/ops-web/providers.md`。

固定边界：

- 在线回答使用 execution-control Provider Config 中已验证并激活的完整 role bundle；
- 顶层 Agent Activity 开始时通过 reader role 解析一次 active bundle，在途调用保留该 revision；
- `dev`、`staging`、`production` 使用独立密钥；只有存在预算、限流或供应商隔离需求时，
  才为不同角色创建更多密钥。

## 新增和激活

1. 确认目标环境和使用角色。
2. 必要时在供应商平台创建该环境的密钥。
3. 通过 Ops Web 创建 connection/profile，验证后以 `expectedRevision` 原子激活完整 role
   bundle。
4. 在线运行面确认 reader DSN 和版本化 keyring 可用；admin 服务使用独立 admin DSN、read token
   与 command token。
5. keyring 本地文件权限使用 `0600`；Kubernetes Secret 投影使用 `0440`，由 Pod `fsGroup` 授予
   运行时组只读权限。Kubernetes 使用目录挂载，不使用 `subPath`。
6. 运行所属环境检查和受控冒烟测试。

尚未配置任何 active profile 时，Ops Web 自身仍应就绪并允许进入修复页；依赖缺失 role 的 runtime
必须失败关闭。

## 本地开发

1. 启动 execution-control 本地管理和读取接口，并提供独立 PostgreSQL 管理/读取 DSN
   与版本化 keyring。
2. 通过 `OPS_WEB_EXECUTION_CONTROL_ADMIN_URL`、read token 和 command token 将 Ops Web 指向该
   admin 接口。
3. 启动 Ops Web 后通过同一页面创建、验证并激活 profile。
4. 确认 execution-control runtime reader 能解析同一 active revision。

只确认文件是否存在、解析了哪个配置所有者以及请求是否成功。不得打印原始密钥。

## Worker 平台 Secret 检查

```bash
pnpm exec tsx scripts/deploy/check-worker-secret-presence.ts --env staging --json
```

该命令只查询 Cloudflare Worker 平台要求的 Secret 是否存在，不读取值，也不证明模型 Provider
Config 已创建、验证或激活。在线 Provider Config 必须另行确认：

1. 目标 role bundle 已验证并激活；
2. execution-control 只用 reader role 读取 active revision，并能解密对应 key ID；
3. Ops Web 使用独立 read/command token，浏览器不获得该 token 或数据库凭据；
4. 受控在线请求使用预期 revision。

## 轮换

1. 在供应商平台创建新密钥。
2. 创建新 connection/profile 并完成验证；使用预期 revision 原子激活完整 bundle。
3. 确认新请求使用新 revision，既有请求保持其启动时取得的 revision。
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

Hindsight 模型配置见 [Hindsight 个人记忆运维](./hindsight.md)，评测模型配置见
[Ragas 评测](./ragas.md)。两者不复用本手册的在线 Provider Config。
