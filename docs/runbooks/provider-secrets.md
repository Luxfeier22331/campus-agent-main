---
doc_type: runbook
owner_boundary: docs/runbooks
status: active
---

# 在线模型密钥操作

## 边界

Model Config 管理四个 name 的唯一已验证当前 config：`primary_agent`、
`campus_docs_embedding`、`campus_docs_reranker` 和 `notice_classification`。本文规定这些在线模型
配置中供应商密钥的首次配置、验证、替换、轮换和撤销。Provider 与环境所有权见
`../environment/providers.md`，接口边界见 `../contracts/ops-web/providers.md`。

Hindsight、评测、Sentry、Langfuse、Cloudflare 和其他环境凭据不进入该服务。接口不提供 profile、
revision、bundle、activation、history、fallback 或在线 rollback。不同部署环境是否使用独立密钥由
实际环境、供应商限制和运维需求决定；不为不存在或未启用的环境预建配置。

## 首次配置和替换

1. 确认目标环境与配置名，在供应商侧创建所需 API key。
2. 在 Ops Web 模型配置页面编辑连接。文本配置和 Reranker 可设置各自允许的 provider、Base URL、
   model、protocol 和 API key；Campus Docs Embedding 只允许替换 Base URL 与 API key。
3. 保存时由 Model Config 对候选 config 执行真实 provider 调用。验证失败不会覆盖当前 config。
4. 成功后 Model Config 在一个事务中替换当前 config。API key 不返回浏览器，状态只表示凭据是否
   已配置以及最后验证结果。
5. 目标字段改变会得到新的 `target_sha256`；仅轮换 API key 不改变 hash。在途执行继续使用已
   冻结的 hash，新准入或新制品构建读取新目标。

尚未配置某个 name 时，Ops Web 自身仍可进入修复页；读取该配置的 consumer 必须失败关闭。

## Schema 切换

切换在维护窗口中按固定顺序执行：

1. `run-projection-schema --mode install` 完成 execution-control 的全部历史 Goose migration，并在
   需要时使用旧 Provider Config keyring/密钥处理历史版本；
2. `model-config-schema` 使用既有 `campus_agent` 数据库 owner、新 Model Config 加密密钥和旧
   `execution-provider-config-encryption` 密钥；
3. 同一事务读取旧 `execution_control.model_settings`，解密并映射为稳定 name，检查已存在新 config
   是否与旧目标冲突，以新 AAD/密钥重加密后写入 `model_config.model_configs`；
4. 所有行成功后删除旧 table 与 compatibility view，安装 `model_config` role grants；任何失败
   都回滚。

不得手工复制、双写、保留兼容读取或让 consumer 回退旧表。新环境也按同一顺序安装，旧表为空时
迁移后得到空 configs。源码仓只交付命令与 desired state；环境仓负责实际 Secret、镜像选择和维护
窗口执行。

## 本地开发

`pnpm dev:init` 为每个 worktree 维护两个不同的私有文件：

- `var/dev/provider-config-encryption.key`：只供 execution-control 历史 migration 与一次性切换读取；
- `var/dev/model-config-encryption.key`：Model Config 当前密文使用。

本地 bootstrap 先运行 execution-control schema，再运行 Model Config schema。`pnpm dev:init` 为
Model Config 和所有内部 consumer 生成同一 worktree 的 `MODEL_CONFIG_URL`；不生成 Model Config 调用
token。两个加密密钥文件不得打印、复制到其他 worktree 或提交。

linked worktree 首次运行 `pnpm dev:init` 时，会从 main checkout 根 `.env` 按白名单导入尚未存在的
provider 外部连接字段，并导入可用的门户 TGC。它不复制数据库连接、在线配置密文或任一 encryption key；
导入值也不会自动写入 Model Config，仍需通过 Ops Web 保存并验证。两个加密密钥文件不得打印、复制到
其他 worktree 或提交。

## 轮换

Provider API key 可通过保存同一目标的新 key 完成，验证通过后撤销旧 key。Model Config 数据加密
密钥当前不提供在线 rekey 或多 key fallback；若需轮换，必须先实现并验证一次性事务迁移，不能仅替换
Secret。Model Config 没有需要轮换的内部调用 token。

## 禁止事项

- 不在 issue、PR、日志、截图、fixture、工作流载荷或浏览器响应中记录原始密钥；
- 不让 consumer 从通用环境变量直接获得在线 provider API key；
- 不恢复 execution-control admin/snapshot listener 或数据库 ownership；
- 不把 Hindsight、eval provider 或未来假设性路由放入 Model Config；
- 不把渲染成功或源码合并描述为环境迁移已经完成。

Hindsight 模型配置见 [Hindsight 个人记忆运维](./hindsight.md)，评测模型配置见
[Ragas 评测](./ragas.md)。
