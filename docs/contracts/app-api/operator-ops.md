---
doc_type: contract
owner_boundary: apps/app-api
status: active
---
# App API 运维 HTTP 合同

## 文档边界

本文定义 `apps/app-api` 面向 Operator Console 的运维接口通用规则。

它回答：

- `/api/ops/*` 的调用方、授权、错误、分页与审计规则；
- Operator Console 与 `app-api` 的代理边界；
- 草稿、发布候选、发布版本和已发布读取模型的通用响应结构；
- 供应商配置命令与内部配置导出的边界。

它不负责：

- 食堂领域对象字段，见 [dining-ops.md](./dining-ops.md)；
- 运维观测查询，见 [observability.md](./observability.md)；
- 学生侧接口，见 [README.md](./README.md)；
- 认证、会话和 OAuth 供应商细节。

## 调用方

`/api/ops/*` 的 browser surface owner 是 Operator Console。当前 dining operations
implementation surface 是 `apps/operator-console-web`。

调用形态固定为：

```text
运维浏览器 -> Operator Console 操作界面 -> app-api /api/ops/*
```

当前 `operator-console-web` Worker 只允许显式 proxy 已实现的 operations routes：
`/api/ops/dining/*` 与 `/api/operator/provider-config/*`。它不开放 generic `/api/*`，也不 proxy
`/api/auth/*` 或 `/api/federation/*`。

Provider configuration routes：

- `GET /api/operator/provider-config/connections`
- `POST /api/operator/provider-config/connections`
- `PATCH /api/operator/provider-config/connections/:connectionId`
- `GET /api/operator/provider-config/profiles`
- `POST /api/operator/provider-config/profiles`
- `PATCH /api/operator/provider-config/profiles/:profileId`
- `POST /api/operator/provider-config/profiles/:profileId/validate`
- `POST /api/operator/provider-config/profiles/:profileId/activate`

长期 operator namespace 优先使用 `/api/operator/*`。`/api/ops/dining/*` 是当前 accepted
dining operations route inventory，不表示存在第二套长期 ops product backend。

## 授权

当前实现使用 `ResolvedAppPrincipal.permissions.operator === true` 作为 ops route admission。
Operator Console Worker 可以把两类 Cloudflare Access admission 映射到 app-api operator
principal：

- human operator：Access JWT 携带 `email` / `sub`，Worker 通过
  `x-app-operator-email`、`x-app-operator-id` 与 `x-app-internal-auth` 转发；
  app-api 要求 `x-app-internal-auth` 匹配 `APP_API_INTERNAL_SHARED_SECRET`，且 email 命中
  `APP_API_OPERATOR_EMAIL_ALLOWLIST`
- machine operator：Access service token JWT 携带
  `common_name=<client-id>.access` 且 `sub=""`；Worker 只有在 client id 命中
  `OPERATOR_CONSOLE_ACCESS_SERVICE_TOKEN_OPERATOR_ALLOWLIST` 时才转发
  `x-app-operator-service-id`；app-api 还要求 service id 命中
  `APP_API_OPERATOR_SERVICE_ID_ALLOWLIST`

service token admission 只用于受控运维自动化，不代表普通 service principal 可以访问
operator routes。

普通 end-user、未准入的 service principal、未登录请求和非 operator principal 对
`/api/ops/*` 必须失败关闭。

## 错误结构

所有错误响应复用 `docs/contracts/app-api/error.md`。

常见 code：

- `session_required`
- `forbidden`
- `validation_failed`
- `dining_floor_not_found`
- `dining_window_not_found`
- `dining_assignment_not_found`
- `dining_menu_item_not_found`
- `dining_menu_offering_not_found`
- `dining_release_candidate_not_found`
- `dining_release_candidate_stale`
- `dining_release_blocked`
- `dining_floorplan_manifest_not_found`
- `dining_floorplan_manifest_mismatch`
- `dining_release_not_published`
- `provider_profile_missing`
- `provider_profile_not_found`
- `provider_profile_not_validated`
- `active_provider_profile_immutable`
- `embedding_profile_incompatible`

## 发布候选结构

Ops release candidate command 返回：

```json
{
  "candidate": {
    "approvedAt": null,
    "approvedBy": null,
    "baseDraftVersionId": "dining_draft_version:42",
    "candidateId": "dining_release_candidate:...",
    "createdAt": "2026-06-11T00:00:00.000Z",
    "createdBy": "operator_01",
    "notes": "调整一食堂价格",
    "publishMode": "manual",
    "scheduledAt": null,
    "snapshotHash": "sha256:...",
    "status": "candidate"
  },
  "validationReport": {
    "blockers": [],
    "status": "pass",
    "warnings": []
  }
}
```

规则：

- release candidate 从一个明确 draft version 创建
- release candidate 冻结 floorplan manifest refs、checksums、anchors 与 window binding
- mutable draft 不能直接发布
- approved candidate 可以立即发布或定时发布
- scheduled job 只能发布 approved candidate，不能发布当前 draft
- candidate publish 失败时不更新 latest published snapshot

## 已发布版本结构

Ops publish command 返回：

```json
{
  "release": {
    "createdAt": "2026-06-08T00:00:00.000Z",
    "createdBy": "operator_01",
    "candidateId": "dining_release_candidate:...",
    "notes": "调整一食堂价格",
    "publishedAt": "2026-06-08T00:00:00.000Z",
    "publishedBy": "operator_01",
    "releaseId": "dining_release:...",
    "snapshotHash": "sha256:...",
    "status": "published"
  },
  "snapshot": {}
}
```

规则：

- release snapshot 是学生端 `/api/dining/*` 的读取 truth
- draft tables 不能直接被 `campus-web` 读取
- release candidate 不能被 `campus-web` 读取
- release publish 必须写 audit event
- release 不允许 best-effort 部分发布；失败时不更新 latest published snapshot

## 审计结构

Audit list 返回：

```json
{
  "events": [
    {
      "action": "menu_offering.updated",
      "actorDisplayName": "Ops User",
      "actorPrincipalId": "operator_01",
      "after": {},
      "auditEventId": "dining_audit:...",
      "before": {},
      "objectId": "offering:...",
      "objectKind": "dining.menu_offering",
      "occurredAt": "2026-06-08T00:00:00.000Z"
    }
  ]
}
```

规则：

- audit event 保存 object-level before/after summary
- audit response 不暴露 raw auth row、session token、operator cookie 或 secret
- operator identity 只投影 principal id 和 display name

## 分页

当前 dining ops list routes 只返回 bounded in-memory/DB result set，不冻结 cursor
pagination shape。新增大列表时必须先在本 contract 中冻结 `limit`、`cursor` 和排序规则。

## 供应商配置结构

返回 Operator Console 的连接、配置列表和命令响应不得包含原始 API 密钥。

连接摘要结构：

```json
{
  "connection": {
    "baseUrl": "https://provider.example/v1",
    "features": ["prompt", "embedding"],
    "featureConfig": {},
    "connectionId": "provider_connection_...",
    "provider": "openai-compatible",
    "revision": 1,
    "secretConfigured": true,
    "secretFingerprint": "sha256:...",
    "secretLast4": "1234",
    "updatedAt": "2026-06-16T00:00:00.000Z"
  }
}
```

配置摘要结构：

```json
{
  "profile": {
    "active": true,
    "baseUrl": "https://provider.example/v1",
    "connectionId": "provider_connection_...",
    "dimensions": 2560,
    "kind": "embedding",
    "model": "Qwen3-Embedding-4B",
    "profileId": "provider_profile_...",
    "provider": "openai-compatible",
    "revision": 3,
    "role": "rag_query_embedding",
    "secretConfigured": true,
    "secretFingerprint": "sha256:...",
    "secretLast4": "1234",
    "status": "active",
    "timeoutMs": 30000,
    "transport": "embeddings",
    "updatedAt": "2026-06-16T00:00:00.000Z",
    "validation": {
      "message": "embedding provider validated",
      "observedDimensions": 2560,
      "ok": true,
      "status": "passed"
    }
  }
}
```

允许的角色：

- prompt: `primary_agent`, `hindsight_llm`,
  `eval_ragas_llm`, `eval_judge_llm`
- embedding: `rag_query_embedding`, `index_embedding`,
  `hindsight_embedding`, `eval_ragas_embedding`

`primary_agent` 覆盖完整 OpenAI Agents SDK 运行，包括 Knowledge Agent handoff。不再
准入独立的在线答案生成或公开网页供应商角色。

规则：

- 供应商、base URL、工具专用传输设置和原始 API 密钥由供应商连接拥有；
- 配置把一个活动角色绑定到连接、模型、类型、传输、超时和类型专用维度；
- 已激活配置不可修改；替换时必须创建未激活的新版本，验证后再激活；
- 激活必须已有通过的验证结果；
- 激活向量模型前，必须调用 execution-control 内部接口
  `POST /internal/provider-config/embedding:check-compatibility`，检查当前向量维度兼容性；
- 原始 API 密钥只能出现在创建或更新命令体，以及 app-api 加密连接存储中；运维列表响应
  不得返回原始密钥。

内部供应商配置导出：

```text
GET /api/internal/provider-config/active?role=primary_agent
```

该接口要求 `x-app-internal-auth`。响应通过供应商连接解析已激活配置，包含原始
`api_key`、`base_url`、`kind` 和可选 `tool_config`。它只供显式投影同步任务调用；自托管
运行时必须读取本地 `provider_config_projection.v1` 产物，不得在请求热路径调用该接口。
该接口不面向浏览器。

内部 OpenAI 兼容代理：

```text
POST /api/internal/provider-config/openai-compatible/:role/v1/responses
POST /api/internal/provider-config/openai-compatible/:role/v1/chat/completions
```

该接口要求 `Authorization: Bearer <APP_API_INTERNAL_SHARED_SECRET>`。它读取 `:role` 的
已激活供应商配置，用活动模型覆盖请求体 `model`，再携带活动 API 密钥转发到配置的
`base_url`。该代理只服务需要 OpenAI 兼容接口的内部调用方，供应商事实仍由 app-api 配置
拥有；浏览器不得调用。

向量模型兼容性检查：

```text
app-api 激活供应商配置
-> execution-control /internal/provider-config/embedding:check-compatibility
```

规则：

- 请求使用 `EXECUTION_CONTROL_SHARED_SECRET` 和 `x-worker-origin-auth`；
- 请求体包含角色、供应商、传输、base URL、模型、维度和超时，不得包含原始 API 密钥；
- `rag_query_embedding` 和 `index_embedding` 根据已激活的 RAG 发布元数据检查兼容性；
  `hindsight_embedding` 只验证供应商连接，不与 RAG 发布元数据比对；
- Hindsight 运行环境从已激活的 `hindsight_llm` 和 `hindsight_embedding` 配置生成；已退役
  的 `memory_graph_llm`、`personal_memory_extraction` 和
  `personal_memory_embedding` 仍为无效角色；
- 不兼容或不支持的角色返回 `{ "ok": false, "reason": "..." }`，app-api 激活失败关闭。
