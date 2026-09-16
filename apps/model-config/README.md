# model-config

Model Config 负责具名在线模型配置及其 Provider API Key。当前配置名为
`primary_agent`、`campus_docs_embedding`、`campus_docs_reranker` 和
`notice_classification`、`document_ocr`。`name` 表示产品配置槽位，`api_protocol` 决定验证与调用方式；服务不维护
额外的模型类型或 consumer 类型字段。

服务不代理模型请求。内部 consumer 读取一次完整配置后直接调用 Provider。`target_sha256` 只包含
`name`、`provider`、`api_protocol`、规范化 Base URL 和 model，不包含 API Key，因此仅轮换 API Key
不会改变目标 hash。

`primary_agent` 支持 `openai` / `openai-compatible` 的 `openai.responses`、
`openai.chat_completions`，以及 `google` 的 `google.generate_content`。Gemini 的 Base URL 包含版本路径
（官方为 `https://generativelanguage.googleapis.com/v1beta`），验证使用 `:generateContent`，模型发现
使用分页 `/models`，鉴权使用 `x-goog-api-key`。Gemini 只开放给主模型槽位，不扩展到 Embedding、
Reranker 或通知分类。切换需通过管理接口验证后保存；运行中的请求仍按既有 target hash 绑定，
不会自动切回 OpenAI。

## HTTP 合同

服务通过 `MODEL_CONFIG_HOST` 和 `MODEL_CONFIG_PORT` 提供单一 listener，默认端口为 `8000`：

- `GET /internal/model-targets/{name}`：读取不含 API Key 的目标和 hash；
- `GET /internal/model-configs/{name}`：读取完整运行配置；
- `GET /internal/model-configs/{name}?expected_target_sha256={hash}`：只在目标仍匹配预期 hash 时读取；
- `GET /internal/admin/model-configs`：读取管理状态；
- `PUT /internal/admin/model-configs/{name}`：验证后替换当前配置；
- `POST /internal/admin/model-configs/{name}/validate`：使用当前配置重新验证并只更新验证结果；
- `POST /internal/admin/model-configs/{name}/models`：发现 Provider 模型。

`document_ocr` 使用 PaddleOCR 的 `paddleocr.jobs` 协议和 `PaddleOCR-VL-1.6`：
PUT 只检查配置字段并加密保存，重置验证状态，不在 HTTP 请求里等待 OCR。
Ops 发起异步验证任务，Document OCR Job 完成后调用
`POST /internal/admin/model-configs/document_ocr/validation-result`，
携带运行配置的 `updated_at` 和验证结果。配置已改变时返回 409，不接受旧结果；
仅 OCR runtime 响应新增 `updated_at`，涵盖不会改变 target hash 的密钥轮换。
其他模型的同步保存、验证行为保持不变。

Primary Agent 在持久执行准入时先读取 target，Agent Runtime 再携带预期 hash 读取完整配置。Campus
Docs Embedding 与 Notice Classifier 等普通 Job 直接读取一次完整配置；Embedding Set 记录响应中的
target hash。

本地 `dev:init` 可以把已配置但尚未验证的连接写入当前配置；这一步不访问 Provider，也不产生验证记录。
因此 `validation`、`validated_at` 和 `validated_by` 可以为 `null`。在线 Ops Web 重新验证不替换当前 target
或 API Key；它只写入 `validation_status`、验证错误/观测信息、`validated_at` 和 `validated_by`，保留
`updated_at` 与 `updated_by`。验证失败仍返回完整的结构化诊断消息，供 Ops Web 显示和排查。

Model Config 位于共同受信任的内部服务边界，不再执行第二次服务间认证，也不登记 consumer 或维护
按配置名的权限矩阵。

管理视图、target 和 runtime 响应使用同一能力推导规则；`hosted_web_search` 表示当前 provider/协议
允许的托管搜索接入，不表示供应商搜索已实测通过。验证状态、时间和操作者全部为空表示未验证；
部分缺失的验证记录返回读取错误，不转换成未验证。

能够访问该 listener 的内部服务可以读取任意具名配置。Ops Web 仍在自身 BFF
边界执行人员认证和 CSRF 校验；`X-Model-Config-Actor` 只用于审计来源。所有配置响应都使用
`Cache-Control: no-store`。

新建或重建数据库的 Schema 由 `campus-agent-schema` 安装，常驻进程不执行 DDL。Job 使用既有
`campus_agent` owner 创建 `model_config` schema、`model_configs` 表和运行角色授权，并与其他产品
schema 共用 `drizzle.campus_agent_migrations`。常驻进程使用 `model_config` runtime role，只获得
schema usage 和所属表的明确读写权限。Provider API Key 加密保存在 `encrypted_api_key`。

统一 schema Job 会拒绝旧 ledger 和 `execution_config`，不提供旧 schema runner 或原位兼容路径；
常驻服务和本地集成测试都使用统一 schema Job 提供的当前结构。

详见 [ADR-0093](../../.agents/notes/implemented/architecture/2026-08-22-adr-0093-model-config-boundary.md) 和
[密钥 runbook](../../docs/runbooks/provider-secrets.md)。
