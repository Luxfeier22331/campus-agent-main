---
doc_type: runbook
owner_boundary: model-config
status: active
---

# 在线模型密钥操作

## 边界

Model Config 管理五个 name 的当前 config：`primary_agent`、
`campus_docs_embedding`、`campus_docs_reranker`、`notice_classification` 和 `document_ocr`。本文规定这些在线模型
配置中供应商密钥的首次配置、验证、替换、轮换和撤销。Provider 与环境所有权见
[Provider 与 Secret](../../environment/providers.md)，接口边界见 [模型配置接口](../../contracts/ops-web/providers.md)。

Hindsight、评测、Langfuse、Cloudflare 和其他环境凭据不进入该服务。接口不提供 profile、
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

`document_ocr` 由文档 OCR consumer 使用，不属于当前 Ops Web 的四种 UI kind。首次配置和替换通过
Model Config 的内部管理接口完成；候选设置会调用 PaddleOCR `paddleocr.jobs` 协议进行异步验证，
验证结果通过带 `updated_at` 条件的回写接口更新，旧验证结果不能覆盖较新的配置。验证失败不覆盖
当前配置，consumer 在配置缺失或验证失败时必须失败关闭。

## 数据库入口状态

新建或重建的本地数据库由 `campus-agent-schema` 直接安装最终 `model_config` 结构和授权。统一 Job
会拒绝带旧领域 migration ledger 或 `execution_config` 的数据库；已有统一 ledger 的数据库按
`campus-agent-schema` 的具名迁移合同升级。

统一 schema Job 的期望拓扑位于 `data-postgres` Application。具体环境是否已经应用某个 revision，
以 GitOps 选择、schema Job 结果和统一 ledger 为准。

## 本地开发

包含 `core` 或 `model-config` 投影的 `pnpm dev:init -- --target <target>` 为每个 worktree 维护 `var/dev/model-config-encryption.key`，供 Model Config 当前密文
使用。凭据与模型通过 `pnpm dev:local -- credentials import --target <target>` 和
`pnpm dev:local -- models seed --target <target>` 显式准备。seed
只写入缺失 name，不覆盖已有配置，不访问 Provider，也不产生 validation 记录。它不再生成旧的
Provider Config 密钥文件；加密密钥仅使用 `model-config-encryption.key`。
`core`、`ops-web` 和 `notice-classifier` projection 会在实际消费者需要时生成同一
worktree 的 `MODEL_CONFIG_URL`，不生成 Model Config 调用 token。加密密钥文件不得打印、复制到其他 worktree
或提交。

linked worktree 显式运行 `pnpm dev:local -- credentials import --target <target>` 时，仅在 target 包含 `core` 或 `model-config`
投影时从 main checkout 根 `.env` 按白名单导入尚未存在的 provider 外部连接字段；仅在包含
`internal-portal-collection` 投影时首次导入可用的门户 TGC。它不复制数据库连接、在线配置密文或 encryption key；
再执行 `models seed` 才会写入当前 worktree 的缺失模型配置；已有名称不再要求 provider 环境变量。
这一步仍不访问 Provider。在线 Ops Web 保存或重新验证才会产生 validation 记录。

## 轮换

Provider API key 可通过保存同一目标的新 key 完成，验证通过后撤销旧 key。Model Config 数据加密
密钥当前不提供在线 rekey 或多 key fallback；若需轮换，必须先实现并验证一次性事务迁移，不能仅替换
Secret。Model Config 没有需要轮换的内部调用 token。

## 禁止事项

- 不在 issue、PR、日志、截图、fixture、工作流载荷或浏览器响应中记录原始密钥；
- 不让 consumer 从通用环境变量直接获得在线 provider API key；
- 不恢复 agent-control admin/snapshot listener 或数据库 ownership；
- 不把 Hindsight、eval provider 或未来假设性路由放入 Model Config；
- 不把渲染成功或源码合并描述为环境迁移已经完成。

## 相关文档

Hindsight 模型配置见 [Hindsight 个人记忆运维](../runtime/hindsight.md)，评测模型配置见
[Inspect 评测](../inspect.md)。
