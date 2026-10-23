---
doc_type: architecture
owner_boundary: model-config
status: active
---

# Model Config

Model Config 是具名在线模型配置与 Provider API Key 的唯一所有者。单一 listener 默认监听 `8000`，
同时提供内部读取和管理接口。浏览器、工作流载荷和运行投影都不携带 API key。

消费链路为：

1. agent-control 读取 `primary_agent` 的 `model_target.v1`，并把 Model Config 返回的 opaque hash
   写入持久执行准入；
2. Agent Runtime 携带该 hash 读取 `model_runtime_config.v1`，hash 不匹配时失败关闭；
3. Campus Search service 在工具调用时读取 Embedding 与 Reranker 完整配置并直接调用 Provider；
   agent-runtime 工具 Activity 只通过该服务的 typed HTTP client 消费检索结果，不把这些配置冻结到 Agent 的准入输入；
4. Campus Docs Embedding 与 Notice Classifier 等普通 Job 一次读取所属具名配置的完整
   `model_runtime_config.v1` 并直接调用 Provider；
5. Embedding Set 等需要记录目标身份的制品直接保存响应中的 target hash。

Model Config 与调用方位于共同受信任的内部服务边界，不再建立 consumer token、注册表或按配置名的
权限矩阵。能够访问 listener 的内部服务可以读取任意具名配置；新增 consumer 不需要修改 Model Config
授权。Ops Web 自身的人员认证与 CSRF 校验保留，`X-Model-Config-Actor` 只作为审计来源。所有 consumer
读取后直接调用 Provider，Model Config 不成为模型流量代理。当前仓库提供上述具名在线配置；离线 Inspect
profile 保持独立。

各配置名的当前消费者：

| name | 消费者 |
| --- | --- |
| `primary_agent` | agent-control（执行准入读取 target）、agent-runtime（携带预期 hash 读取完整配置） |
| `campus_docs_embedding` | Campus Search service、campus-docs-index-publisher、notice-index-publisher、retrieval-index（目标一致性检查） |
| `campus_docs_reranker` | Campus Search service |
| `notice_classification`（别名，解析到 `notice_classification_decision` 或 `notice_classification_llm`） | notice-pipeline-worker（分类 activity，复用 notice-classifier 运行时） |
| `document_ocr` | document-ocr job（读取配置并回写异步验证结果） |

Ops Web 通过管理接口保存和重新验证全部存储名，并通过 `config-selections` 切换通知分类后端，不直接调用
Provider。通知分类的决策模型与 LLM 各存一份凭据，切换不丢 Key；`model_config.config_selections` 每个别名
一行，是读取别名的唯一来源。

`name` 表达产品配置槽位，`api_protocol` 决定验证与调用方式；Model Config 不保存独立模型类型字段。
数据库保存每个 name 的当前配置和加密 API key；验证是可选状态。新建或重建数据库由
`campus-agent-schema` 使用既有 `campus_agent` owner 安装并拥有 `model_config` schema，与其他产品
schema 共用 `drizzle.campus_agent_migrations`；常驻服务使用 `model_config` runtime role，后者不执行
DDL。Ops Web 与 agent-control 没有该表的数据库权限。详细决定见
[Model Config 独立边界](../../../.agents/notes/implemented/architecture/2026-08-22-model-config-boundary.md)，HTTP 管理投影见
[Ops Web Provider 合同](../../contracts/ops-web/providers.md)。
