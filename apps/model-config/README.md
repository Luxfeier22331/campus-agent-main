# model-config

Model Config 负责具名在线模型配置及其 Provider API Key。当前配置名为
`primary_agent`、`campus_docs_embedding`、`campus_docs_reranker` 和
`notice_classification`。`name` 表示产品配置槽位，`api_protocol` 决定验证与调用方式；服务不维护
额外的模型类型或 consumer 类型字段。

服务不代理模型请求。内部 consumer 读取一次完整配置后直接调用 Provider。`target_sha256` 只包含
`name`、`provider`、`api_protocol`、规范化 Base URL 和 model，不包含 API Key，因此仅轮换 API Key
不会改变目标 hash。

## HTTP 合同

服务通过 `MODEL_CONFIG_HOST` 和 `MODEL_CONFIG_PORT` 提供单一 listener，默认端口为 `8000`：

- `GET /internal/model-targets/{name}`：读取不含 API Key 的目标和 hash；
- `GET /internal/model-configs/{name}`：读取完整运行配置；
- `GET /internal/model-configs/{name}?expected_target_sha256={hash}`：只在目标仍匹配预期 hash 时读取；
- `GET /internal/admin/model-configs`：读取管理状态；
- `PUT /internal/admin/model-configs/{name}`：验证后替换当前配置；
- `POST /internal/admin/model-configs/{name}/models`：发现 Provider 模型。

Primary Agent 在持久执行准入时先读取 target，Agent Runtime 再携带预期 hash 读取完整配置。Campus
Docs Embedding 与 Notice Classifier 等普通 Job 直接读取一次完整配置；Embedding Set 记录响应中的
target hash。

Model Config 位于共同受信任的内部服务边界，不再执行第二次服务间认证，也不登记 consumer 或维护
按配置名的权限矩阵。能够访问该 listener 的内部服务可以读取任意具名配置。Ops Web 仍在自身 BFF
边界执行人员认证和 CSRF 校验；`X-Model-Config-Actor` 只用于审计来源。所有配置响应都使用
`Cache-Control: no-store`。

Schema 由 `model-config-schema` 安装，常驻进程不执行 DDL。Schema Job 使用既有 `campus_agent`
bootstrap 身份拥有并校验 `model_config` schema、`model_configs` 表和 migration ledger；常驻进程使用
`model_config` runtime role，只获得 schema usage 以及所属表的明确读写权限。Migration 会拒绝未知列、
relation、constraint、index、owner 或 grant，不用 `IF NOT EXISTS` 把漂移伪装成成功。Provider API Key
加密保存在 `encrypted_api_key`。一次性切换期间，schema command 使用旧 execution-control 加密密钥，
事务性迁移 `execution_control.model_settings` 中已验证的数据并删除旧表。必须先运行 execution-control
历史 migration。

详见 [ADR-0093](../../docs/decisions/adr-0093-model-config-boundary.md) 和
[密钥 runbook](../../docs/runbooks/provider-secrets.md)。
