---
doc_type: runbook
owner_boundary: docs/runbooks
status: active
---

# 在线模型密钥操作

## 边界

本文规定在线模型当前设置中供应商密钥的首次配置、验证、替换、轮换和撤销。Provider 与环境
所有权见 `../environment/providers.md`，接口边界见 `../contracts/ops-web/providers.md`。

固定边界：

- execution-control 只管理 `llm` 和 `embedding` 两个当前设置，不提供 profile、role、
  bundle、revision 或 activation；
- 保存前必须通过真实供应商调用，成功后直接替换该 kind 的当前设置；
- 顶层 Agent Activity 开始时读取一次当前 `llm` 设置，在途调用保留该快照；之后的
  Activity 使用更新后的当前设置；
- `llm` 和 `embedding` 分别由使用它们的运行路径失败关闭；Execution Control 顶层就绪只把当前设置
  作为诊断，不复制 Agent worker 和知识检索的能力 gate；
- `dev`、`staging`、`production` 使用独立密钥；只有存在预算、限流或供应商隔离需求时，
  才为两种能力分配不同密钥。

## 首次配置和替换

1. 确认目标环境和配置种类 `llm` 或 `embedding`。
2. 必要时在供应商平台创建该环境的密钥。
3. 在 Ops Web 的“模型配置 > 在线问答”中编辑当前设置。`llm` 可设置 endpoint、model、
   transport；`embedding` 的 model、dimensions 和 transport 由服务合同固定。模型设置不包含
   推理超时；Agent 与 RAG 分别使用所属运行策略的时限。
4. 保存时由 execution-control 调用真实供应商进行验证。验证失败不覆盖当前设置；
   页面返回 `409` 时先重新读取，再由操作者决定是否重新提交。
5. 在线运行面确认 reader DSN 和 keyring 可用；admin 服务使用独立 admin DSN 和
   `OPS_WEB_INTERNAL_TOKEN`。
6. keyring 本地文件权限使用 `0600`；Kubernetes Secret 投影使用 `0440`，由 Pod `fsGroup` 授予
   运行时组只读权限。Kubernetes 使用目录挂载，不使用 `subPath`。
7. 运行所属环境检查和受控冒烟测试。

尚未配置当前设置时，Ops Web 自身仍应就绪并允许进入修复页；依赖该 kind 的 runtime
必须失败关闭。

## Schema 切换

`run-projection-schema --mode install` 是唯一 schema 切换入口。检测到完整旧结构时，它在一个事务和
advisory lock 内创建 `model_settings`，读取当前激活的 LLM 与 Embedding，使用旧 AAD 解密并按
`execution_config.model_settings:<kind>` 重加密，验证两个设置后删除七张旧表并应用当前权限。

旧结构不完整、当前表已经含有数据、激活配置缺失、验证未通过、密钥无法解密或旧表存在未知依赖时，
整个事务回滚。不得手工复制数据、保留新旧表并存、双写或让运行时回退到旧表。切换发布允许在线问答
短暂不可用；旧构建不能作为数据库切换后的回滚目标。

没有旧结构的新环境可以用空的 `model_settings` 完成安装，并通过 Ops Web 分别配置 LLM 和
Embedding。只配置其中一项时，后续 schema install 仍保持幂等；依赖缺失项的运行路径单独失败。

## 本地开发

1. 启动 execution-control 本地管理和读取接口，并提供独立 PostgreSQL 管理/读取 DSN
   与版本化 keyring。
2. 通过 `OPS_WEB_EXECUTION_CONTROL_ADMIN_URL` 和 `OPS_WEB_INTERNAL_TOKEN` 将 Ops Web 指向该
   admin 接口。
3. 启动 Ops Web 后通过同一页面保存并验证当前设置。
4. 确认 execution-control runtime reader 能解密并解析当前设置。

只确认文件是否存在、解析了哪个配置所有者以及请求是否成功。不得打印原始密钥。

## Worker 平台 Secret 检查

```bash
pnpm exec tsx scripts/deploy/check-worker-secret-presence.ts --env staging --json
```

该命令读取目标环境最新 Worker version 的 Secret 名称，不读取值。远端名称必须与
`wrangler.toml` 的 `[env.<name>.secrets].required` 精确一致；缺失或多余字段都会使检查失败。
修正命令使用 `wrangler versions secret put/delete` 创建新的候选 version，不通过
`wrangler secret put/delete` 直接切换流量。该检查不证明在线模型当前设置已配置或可用。
在线模型必须另行确认：

1. 目标 kind 的当前设置存在，最后验证通过；
2. execution-control 只用 reader role 读取当前设置，并能解密对应 key ID；
3. Ops Web 服务端使用 `OPS_WEB_INTERNAL_TOKEN`，浏览器不获得该 token 或数据库凭据；
4. 受控在线请求使用预期 endpoint 和 model。

## 轮换

1. 在供应商平台创建新密钥。
2. 在目标 kind 的当前设置中填入新密钥并保存。真实供应商验证失败时保留旧设置。
3. 确认新的 Activity 使用新密钥，已经取得旧快照的在途 Activity 不受影响。
4. 完成环境检查和冒烟测试。
5. 撤销旧密钥。

疑似泄露时先切换并立即撤销旧密钥，再检查近期日志、构建产物、截图和共享记录。

## 禁止事项

- 不把仓库根 `.env` 当作部署密钥来源；
- 不让 staging 或 production 共用 dev 密钥；
- 不在 issue、PR、聊天记录、日志、截图或 fixture 中记录原始密钥；
- 不从其他 worktree 复制密钥，也不增加跨 worktree 环境文件分发脚本；
- 不让 agent-runtime 绕过 execution-control 的当前设置直接从环境变量读取在线供应商
  密钥；
- 不恢复 connection、profile、role、bundle、revision 或 activation 界面；
- 不把 Hindsight 或 eval provider 塞入在线当前设置。

Hindsight 模型配置见 [Hindsight 个人记忆运维](./hindsight.md)，评测模型配置见
[Ragas 评测](./ragas.md)。两者不复用本手册的在线当前设置。
