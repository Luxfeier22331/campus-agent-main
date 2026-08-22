---
doc_type: runbook
owner_boundary: docs/runbooks
status: active
---

# 在线模型密钥操作

## 边界

本文规定在线模型当前设置中供应商密钥的首次配置、验证、替换、轮换和撤销。Provider 与环境
所有权见 `../environment/providers.md`，接口边界见 `../contracts/ops-web/providers.md`。
本文只负责 Ops Web 在线模型设置使用的 `llm`、`embedding` 和 `notice_classifier` 供应商密钥；Sentry、
Langfuse、Cloudflare 和其他环境运行凭据由环境仓及其所属交付入口负责，不在本文配置或轮换。

固定边界：

- execution-control 只管理 `llm`、`embedding` 和 `notice_classifier` 三个当前设置，不提供 profile、role、
  bundle、revision 或 activation；
- 保存前必须通过真实供应商调用，成功后直接替换该 kind 的当前设置；
- 顶层 Agent Activity 开始时读取一次当前 `llm` 设置，在途调用保留该快照；之后的
  Activity 使用更新后的当前设置；
- `llm` 和 `embedding` 分别由使用它们的运行路径失败关闭；Execution Control 顶层就绪只把当前设置
  作为诊断，不复制 Agent worker 和知识检索的能力 gate；
- 不同部署环境是否使用独立密钥由实际环境、供应商限制和运维需求决定；不为不存在或未启用的环境
  预建配置。

## 首次配置和替换

1. 确认目标环境和配置种类 `llm`、`embedding` 或 `notice_classifier`。
2. 必要时在供应商平台创建该环境的密钥。
3. 在 Ops Web 的“模型配置”中编辑当前设置。`llm` 和 `notice_classifier` 可设置 provider、endpoint、model
   和 transport；`embedding` 只设置 endpoint 和 API key。固定字段和拒绝字段以 Ops Web 接口合同为
   准；Agent 与 RAG 分别使用所属运行策略的时限。
4. 保存时由 execution-control 调用真实供应商进行验证。验证失败不覆盖当前设置。
5. 确认 execution-control 的 `EXECUTION_CONTROL_DATABASE_URL` 和单一加密密钥文件可用；同一 Deployment
   的 admin 监听器使用 `OPS_WEB_INTERNAL_TOKEN` 鉴权。
6. 运行时加密密钥文件使用 `0600`；Kubernetes Secret 投影使用 `0440`，由 Pod `fsGroup` 授予
   运行时组只读权限。Kubernetes 使用目录挂载，不使用 `subPath`。
7. 如果本次操作明确包含环境验证，按目标环境的操作手册执行；本文不定义线上验收命令。

尚未配置当前设置时，Ops Web 自身仍应就绪并允许进入修复页；依赖该 kind 的 runtime
必须失败关闭。

## Schema 切换

`run-projection-schema --mode install` 是唯一 schema 切换入口。检测到完整旧结构时，Goose v3 在
一个事务和 advisory lock 内创建 `execution_config.model_settings`，读取当前激活的 LLM 与
Embedding，使用旧 AAD 解密并按不可变 AAD v1
`execution_config.model_settings:<kind>` 重加密，验证两个设置后删除七张旧表。Goose v4 随后将该表
原位移动到 `execution_control.model_settings`；表所在 schema 改变不触发再次加密，也不增加双 AAD
读取。Goose v5 在新路径创建 `campus_docs_serving.current_index` 并暂时增加索引绑定所需的
`embedding_space_id`；后续 Goose v6 从模型设置和当前索引删除重复的向量空间字段。Goose v7 将现有
Embedding 行规范为固定 provider、model 和 transport，保留 endpoint 与加密 API key，并要求重新
验证。Go migration v8 将现有 `model_settings` 中的旧 keyring 密文一次性重加密为单一
`encryption.key` 密文，随后删除旧 key ID、指纹和末四位列并重建只读兼容视图；常驻 runtime 不再读取
keyring。Goose v9 删除当前索引中剩余的查询定义字段，只保留 collection 指针。新设置只允许替换连接
endpoint 和凭据，索引定义由当前 Publisher 与 execution-control 代码共同确定。

旧结构不完整、当前表已经含有数据、激活配置缺失、验证未通过、密钥无法解密或旧表存在未知依赖时，
整个事务回滚。不得手工复制数据、保留新旧表并存、双写或让运行时回退到旧表。切换发布允许在线问答
短暂不可用；旧构建不能作为数据库切换后的回滚目标。

没有旧结构的新环境可以用空的 `model_settings` 完成安装，并通过 Ops Web 分别配置 LLM、Embedding 和
通知分类。只配置其中一项时，后续 schema install 仍保持幂等；依赖缺失项的运行路径单独失败。历史
密文存在时 schema Job 需要同时取得迁移专用旧 keyring 和新的 `encryption.key`；空表不需要旧 keyring。

## 本地开发

1. 启动 execution-control 本地运行与管理监听器，并提供一个 PostgreSQL DSN 与单一 `encryption.key` 文件。
2. 通过 `OPS_WEB_EXECUTION_CONTROL_ADMIN_URL` 和 `OPS_WEB_INTERNAL_TOKEN` 将 Ops Web 指向该
   admin 接口。
3. 启动 Ops Web 后通过同一页面保存并验证当前设置。
4. 确认 execution-control runtime 能解密并解析当前设置。

只确认文件是否存在、解析了哪个配置所有者以及请求是否成功。不得打印原始密钥。

在线模型必须另行确认：

1. 目标 kind 的当前设置存在，最后验证通过；
2. execution-control 使用 `execution_control` 角色读取当前设置，并能使用 `encryption.key` 解密；
3. Ops Web 服务端使用 `OPS_WEB_INTERNAL_TOKEN`，浏览器不获得该 token 或数据库凭据；
4. 受控在线请求使用预期 endpoint 和 model。

## 轮换

1. 在供应商平台创建新密钥。
2. 在目标 kind 的当前设置中填入新密钥并保存。真实供应商验证失败时保留旧设置。
3. 确认新的 Activity 使用新密钥，已经取得旧快照的在途 Activity 不受影响。
4. 如果本次轮换明确包含环境验证，按目标环境的操作手册执行；本文不定义线上验收命令。
5. 撤销旧密钥。

疑似泄露时先切换并立即撤销旧密钥，再检查近期日志、构建产物、截图和共享记录。

## 禁止事项

- 不把仓库根 `.env` 当作部署密钥来源；
- 环境间是否共享密钥按实际配置和供应商约束决定，不通过环境名称自动生成额外配置；
- 不在 issue、PR、聊天记录、日志、截图或 fixture 中记录原始密钥；
- 不从其他 worktree 复制密钥，也不增加跨 worktree 环境文件分发脚本；
- 不让 agent-runtime 绕过 execution-control 的当前设置直接从环境变量读取在线供应商
  密钥；
- 不恢复 connection、profile、role、bundle、revision 或 activation 界面；
- 不把 Hindsight 或 eval provider 塞入在线当前设置。

Hindsight 模型配置见 [Hindsight 个人记忆运维](./hindsight.md)，评测模型配置见
[Ragas 评测](./ragas.md)。两者不复用本手册的在线当前设置。
