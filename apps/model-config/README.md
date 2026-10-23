# model-config

Model Config 是具名在线模型配置及其 Provider API Key 的唯一所有者，负责保存、验证和下发配置；
它不代理模型请求，内部 consumer 读取配置后直接调用 Provider。

当前存储的配置名为 `primary_agent`、`campus_docs_embedding`、`campus_docs_reranker`、
`notice_classification_decision`、`notice_classification_llm` 和 `document_ocr`。`name` 表示产品配置槽位，
`api_protocol` 决定验证与调用方式；服务不维护额外的模型类型或 consumer 类型字段。

`notice_classification` 是只读别名，不存行：`model_config.config_selections` 记录它当前选中的凭据，
target 和 runtime 读取在同一条 SQL 里解析到所选行，响应中的 `name` 是被选中的存储名。没有选择时按
未找到返回 404，不回退到另一家。

`target_sha256` 只包含 `name`、`provider`、`api_protocol`、规范化 Base URL 和 model，不包含
API Key，因此仅轮换 API Key 不会改变目标 hash。

## HTTP 合同

服务通过 `MODEL_CONFIG_HOST` 和 `MODEL_CONFIG_PORT` 提供单一 listener，默认端口为 `8000`：

- `GET /internal/model-targets/{name}`：读取不含 API Key 的目标和 hash；
- `GET /internal/model-configs/{name}`：读取完整运行配置；
- `GET /internal/model-configs/{name}?expected_target_sha256={hash}`：只在目标仍匹配预期 hash 时读取；
- `GET /internal/admin/model-configs`：读取管理状态；
- `PUT /internal/admin/model-configs/{name}`：验证后替换当前配置；
- `POST /internal/admin/model-configs/{name}/validate`：使用当前配置重新验证并只更新验证结果；
- `POST /internal/admin/model-configs/{name}/models`：发现 Provider 模型；
- `POST /internal/admin/model-configs/document_ocr/validation-result`：回写异步 OCR 验证结果；
- `PUT /internal/admin/config-selections/{alias}`：请求体 `{config_name}`，把别名指向一个验证通过的
  存储配置，不调用 Provider、不改凭据；未保存、未通过验证或不属于该别名时返回 422
  `selection_not_ready`。

管理写接口只接受存储名；对别名 `notice_classification` 的 `PUT`、`validate` 和 `models` 返回 404。
管理状态的 `selections` 按别名列出当前选择。

## 验证与保存

`PUT` 对候选配置执行真实 Provider 调用，验证通过后在事务中替换当前配置；验证失败不覆盖当前值。

在线 Ops Web 重新验证不替换当前 target 或 API Key，只写入 `validation_status`、验证错误/观测信息、
`validated_at` 和 `validated_by`，保留 `updated_at` 与 `updated_by`。验证失败仍返回完整的结构化
诊断消息，供 Ops Web 显示和排查。验证状态、时间和操作者全部为空表示未验证；部分缺失的验证记录
返回读取错误，不转换成未验证。

本地初始化不会导入 provider 凭据或写入模型配置。维护者可先运行 `pnpm dev:local -- credentials import --target <target>`，再运行 `pnpm dev:local -- models seed --target <target>`；模型 seed 只写入缺失的配置，不访问 Provider，也不产生验证记录，因此 `validation`、`validated_at` 和 `validated_by` 可以为 `null`。

`document_ocr` 使用 PaddleOCR 的 `paddleocr.jobs` 协议和 `PaddleOCR-VL-1.6`：`PUT` 只检查配置字段
并加密保存，重置验证状态，不在 HTTP 请求里等待 OCR。Ops 发起异步验证任务，Document OCR Job 完成后
调用 `validation-result` 接口，携带运行配置的 `updated_at` 和验证结果；配置已改变时返回 409，
不接受旧结果。仅 OCR runtime 响应新增 `updated_at`，涵盖不会改变 target hash 的密钥轮换。其他模型
的同步保存、验证行为保持不变。

## 消费方式

Primary Agent 在持久执行准入时先读取 target，Agent Runtime 再携带预期 hash 读取完整配置；运行中的
请求仍按既有 target hash 绑定，配置切换后不会自动切回。Campus Docs Embedding 与 Notice Classifier
等普通 Job 直接读取一次完整配置；Embedding Set 记录响应中的 target hash。各配置名的当前消费者见
[Model Config 架构](../../docs/architecture/system/model-config.md)。

`campus_docs_embedding` 由 Campus Search service、campus-docs-index-publisher、notice-index-publisher 和
retrieval-build 的目标一致性检查各自读取一次完整配置。共同信任边界内重复读取是既有设计：API Key 不出边界，
consumer 各自校验配置并失败
关闭；Model Config 不聚合为模型代理服务，原因见
[边界决策](../../.agents/notes/implemented/architecture/2026-08-22-model-config-boundary.md)。

`primary_agent` 支持 `openai` / `openai-compatible` 的 `openai.responses`、`openai.chat_completions`，
以及 `google` 的 `google.generate_content`。Gemini 的 Base URL 包含版本路径（官方为
`https://generativelanguage.googleapis.com/v1beta`），验证使用 `:generateContent`，模型发现使用分页
`/models`，鉴权使用 `x-goog-api-key`。Gemini 只开放给主模型槽位，不扩展到 Embedding、Reranker 或
通知分类；切换需通过管理接口验证后保存。

通知分类两份凭据各自固定协议：`notice_classification_decision` 只接受 `nace`（Drex）或
`typesafe`（Jev）的 `typesafe.systemone`，`notice_classification_llm` 只接受 `openai` /
`openai-compatible` 的 `openai.responses` 或 `openai.chat_completions`。LLM 验证要求严格 JSON schema
输出 15 个类别与 5 个 intent 内的 `{category,intent}`；System One 验证同时提问 `category` 和 `intent`
两个 choice，答案都必须落在集合内。

本地 seed 从 `NOTICE_CLASSIFICATION_DECISION_{BASE_URL,API_KEY,MODEL,PROVIDER}` 和
`NOTICE_CLASSIFICATION_LLM_{BASE_URL,API_KEY,MODEL,API_PROTOCOL}` 写入完整的那几份凭据（决策模型 provider
默认 `nace`、模型默认 `drex-max`，LLM 协议默认 `openai.chat_completions`），并在别名尚无选择时按
`NOTICE_CLASSIFICATION_BACKEND`（`decision` 或 `llm`）写入选择；未设置时选已配置的一家，两家都有时选决策模型。
本地 seed 不做 Provider 验证，因此写入选择时不要求验证通过；已有选择保持不变。

管理视图、target 和 runtime 响应使用同一能力推导规则；`hosted_web_search` 表示当前 provider/协议
允许的托管搜索接入，不表示供应商搜索已实测通过。

## 信任边界

Model Config 与调用方位于共同受信任的内部服务边界，不再执行第二次服务间认证，也不登记 consumer 或
维护按配置名的权限矩阵。能够访问该 listener 的内部服务可以读取任意具名配置。

Ops Web 仍在自身 BFF 边界执行人员认证和 CSRF 校验；`X-Model-Config-Actor` 只用于审计来源。
所有配置响应都使用 `Cache-Control: no-store`。

## 存储与 Schema

新建或重建数据库的 Schema 由 `campus-agent-schema` 安装，常驻进程不执行 DDL。Job 使用既有
`campus_agent` owner 创建 `model_config` schema、`model_configs` 表和运行角色授权，并与其他产品
schema 共用 `drizzle.campus_agent_migrations`。常驻进程使用 `model_config` runtime role，只获得
schema usage 和所属表的明确读写权限。Provider API Key 加密保存在 `encrypted_api_key`。

统一 schema Job 会拒绝旧 ledger 和 `execution_config`，不提供旧 schema runner 或原位兼容路径；
常驻服务和本地集成测试都使用统一 schema Job 提供的当前结构。

## 相关文档

- [Model Config 架构](../../docs/architecture/system/model-config.md)
- [模型配置接口合同](../../docs/contracts/ops-web/providers.md)
- [Model Config 独立边界决策](../../.agents/notes/implemented/architecture/2026-08-22-model-config-boundary.md)
- [密钥 runbook](../../docs/runbooks/access/provider-secrets.md)
