---
doc_type: decision
owner_boundary: model-config
status: accepted
decision_id: ADR-0093
---

# ADR-0093 Model Config 独立边界

## 决策

在线模型配置由独立的 `apps/model-config` 拥有，不再属于 execution-control。该服务维护四个稳定
name 的当前配置：`primary_agent`、`campus_docs_embedding`、
`campus_docs_reranker` 和 `notice_classification`。`name` 表达产品配置槽位，`api_protocol` 决定
验证和调用方式；Model Config 不增加模型类型字段。它保存加密的 Provider API Key、执行真实 Provider
验证，并通过单一内部 listener 提供读取和管理接口；它不代理模型请求，也不拥有 Agent 或执行工作流。

Primary Agent 的持久执行采用 target → expected target hash →完整 config：execution-control 先冻结不含
凭据的 `model_target.v1`，Agent Runtime 再凭预期 hash 读取 `model_runtime_config.v1`。hash 只包含
`name`、`provider`、`api_protocol`、规范化 Base URL 与 model，不包含 API Key，因此密钥轮换不会改变
运行目标身份。普通 Job 直接读取一次完整配置，不执行 descriptor/resolve 往返；需要记录目标身份的
制品直接使用响应中的 hash。

Model Config 使用 `model_config.*` schema；schema Job 复用既有 `campus_agent` bootstrap role 安装、拥有
并校验该 schema，常驻服务使用独立的 `model_config` runtime role。Ops Web 不直连数据库。Model Config
与 consumer 位于共同受信任的内部服务边界：服务不建立第二次服务间认证、
consumer token、consumer 注册或 name 权限矩阵。任意能够访问 listener 的内部服务都可以读取任意
具名配置，新 consumer 不需要修改 Model Config 授权。Ops Web 自身的人员认证与 CSRF 校验保留；其
传递的 actor 只用于审计。Provider API Key 是该边界内唯一的外部模型凭据。

## 约束

- Chat/Embedding provider 仅为 `openai` 或 `openai-compatible`；Reranker provider 仅为 `cohere`
  或 `cohere-compatible`。API protocol 使用 `openai.responses`、`openai.chat_completions`、
  `openai.embeddings` 或 `cohere.rerank`；
- 每个 name 只有一个当前配置，不提供历史、fallback、router、activation、profile 或在线 rollback；
- 本地 `dev:init` 可以显式写入缺失的已配置连接，不访问 Provider，也不产生 validation 记录；
- 更新必须先验证后原子替换；目标 hash 不匹配返回冲突，consumer 不静默读取新目标；
- Campus Docs Embedding model 和协议仍由 Campus Docs 合同固定；Embedding Set v3 记录 target hash；
- Ragas 离线模型和 reranker profile 保持独立，不接入在线 Model Config；
- execution-control 中的旧 Provider Config 代码只保留为不可修改历史 migration 输入，常驻 runtime
  不再加载旧表、密钥或管理接口；
- schema 切换先完成 execution-control 历史 Goose migration，再由 Model Config 在一个事务中解密、
  冲突校验、重加密、写入新表并删除旧表。维护窗口内允许短暂不可用，不增加双写或兼容读取；
- Agent Control 的 API 与 orchestrator 物理拆分不在本决策中实施，命名重构也不得重新吞并 Model
  Config 所有权。

## 理由

模型目标和凭据被 Agent、离线索引与通知分类共同消费，放在 execution-control 会把执行编排、配置
管理、数据库 ownership 和批处理依赖耦合在一个部署单元。独立边界使模型配置有唯一所有者，同时
让 execution-control 只冻结执行所需的目标身份。单当前配置和无 fallback 保持故障显式，避免形成
未被产品需求证明的模型路由平台。

## 交付边界

源码仓维护服务、合同、迁移、镜像和 Kubernetes desired state；环境仓选择镜像、Secret 和数据库
连接并执行维护窗口切换。本 ADR 接受不等于任一环境已经部署或完成迁移。
