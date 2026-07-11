---
doc_type: contract
truth_scope: ops
owner_boundary: apps/app-api
status: active
created: 2026-06-08
updated: 2026-07-02
---
# App API Operator Operations HTTP Contract

## 文档边界

本文冻结 `apps/app-api` 面向 Operator Console operations domains 的 browser-facing
operator HTTP contract 横切规则。

它回答：

- `/api/ops/*` 的调用方、authz、错误、pagination 与 audit 规则
- Operator Console operations surface 与 `app-api` 的 proxy 边界
- ops draft / release candidate / release / published projection 的通用 envelope
- provider-config / observability-config operator command 与 internal projection
  export 的边界

它不负责：

- dining 领域对象字段，见 `app-api/dining-ops.md`
- operator observability query，见 `app-api/observability.md`
- student-facing campus projection，见 `app-api/README.md`
- auth/session/OAuth provider 细节

## Caller Model

`/api/ops/*` 的 browser surface owner 是 Operator Console。当前 dining operations
implementation surface 是 `apps/operator-console-web`。

调用形态固定为：

```text
operator browser -> operator console operations surface -> app-api /api/ops/*
```

当前 `operator-console-web` Worker 只允许显式 proxy 已实现的 operations routes：
`/api/ops/dining/*`、`/api/operator/provider-config/*` 与
`/api/operator/observability-config/*`。它不开放 generic `/api/*`，也不 proxy
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

Observability configuration routes：

- `GET /api/operator/observability-config/llm-debug-trace`
- `PATCH /api/operator/observability-config/llm-debug-trace`

LLM debug trace config is not a provider-config role. app-api owns the operator
config surface, execution-control consumes the internal projection, and
agent-runtime only receives request-scoped `debug_trace_config`.

长期 operator namespace 优先使用 `/api/operator/*`。`/api/ops/dining/*` 是当前 accepted
dining operations route inventory，不表示存在第二套长期 ops product backend。

## Authz

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

目标权限模型保留以下语义位，但当前代码尚未拥有独立字段：

- `operator_ops_viewer`：读取 ops workspace
- `dining_editor`：编辑 dining draft
- `dining_release_approver`：审批 dining release candidate
- `dining_release_scheduler`：定时发布 dining release candidate
- `dining_publisher`：发布 approved dining release candidate

在细粒度权限落地前，文档不得把这些位写成当前已实现 admission truth。普通 end-user、
service principal、未登录请求和非 operator principal 对 `/api/ops/*` 必须 fail closed。

## Error Envelope

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

## Release Candidate Envelope

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

## Published Release Envelope

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

## Audit Envelope

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

## Pagination

当前 dining ops list routes 只返回 bounded in-memory/DB result set，不冻结 cursor
pagination shape。新增大列表时必须先在本 contract 中冻结 `limit`、`cursor` 和排序规则。

## Provider Config Envelope

Connection / profile list and command responses returned to Operator Console must
not include raw API keys.

Connection summary shape:

```json
{
  "connection": {
    "baseUrl": "https://provider.example/v1",
    "tools": ["embedding", "rerank"],
    "toolConfig": {
      "rerank": {
        "path": "/configured-rerank"
      }
    },
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

Profile summary shape:

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

Accepted roles:

- prompt: `primary_agent`, `hindsight_llm`,
  `eval_ragas_llm`, `eval_judge_llm`
- embedding: `rag_query_embedding`, `index_embedding`,
  `hindsight_embedding`, `eval_ragas_embedding`
- rerank: `rag_reranker`

`primary_agent` covers the complete OpenAI Agents SDK run, including Knowledge
Agent handoff. No separate online answer-generation or public-web provider role
is admitted.

Rules:

- provider, base URL, tool-specific transport settings and raw API key are
  owned by provider connections
- profiles bind an active role to one connection plus model, kind, transport,
  timeout and kind-specific dimensions
- active profiles are immutable; replace by creating a new inactive profile
  revision, validating it and activating it
- activation requires a passing validation result
- embedding activation must check compatibility with active vector dimensions by
  calling execution-control internal
  `POST /internal/provider-config/embedding:check-compatibility`
- raw API keys may appear only in create/update command bodies and app-api
  encrypted connection persistence; they must never appear in operator list
  responses
- `rag_reranker` is consumed only when a collection serving config explicitly
  opts in to reranking; missing provider config, missing configured rerank path,
  provider error or incomplete score response fails closed

Internal provider projection export:

```text
GET /api/internal/provider-config/active?role=primary_agent
```

Requires `x-app-internal-auth`. Response resolves the active profile through its
provider connection and includes raw `api_key`, `base_url`, `kind` and optional
`tool_config`. It is a control-plane export used by explicit projection
sync jobs. Self-host runtimes must consume a local
`provider_config_projection.v1` artifact, not call this endpoint on their hot
path. The endpoint is not browser-facing.

Internal OpenAI-compatible proxy:

```text
POST /api/internal/provider-config/openai-compatible/:role/v1/responses
POST /api/internal/provider-config/openai-compatible/:role/v1/chat/completions
```

Requires `Authorization: Bearer <APP_API_INTERNAL_SHARED_SECRET>`. The route reads
the active provider-config profile for `:role`, overwrites the request body
`model` with the active profile model, forwards to the profile `base_url`, and
uses the active profile API key upstream. It exists for internal provider
consumers that require an OpenAI-compatible endpoint while provider truth remains
in app-api provider-config. Browser clients must not call this proxy.

Embedding compatibility request:

```text
app-api provider-config activation
-> execution-control /internal/provider-config/embedding:check-compatibility
```

Rules:

- request uses `EXECUTION_CONTROL_SHARED_SECRET` / `x-worker-origin-auth`
- request body includes role, provider, transport, base URL, model, dimensions
  and timeout
- request body must not include raw API key
- `rag_query_embedding` / `index_embedding` compatibility is checked against
  active query-serving RAG release metadata; `hindsight_embedding` is validated
  as provider connectivity but is not checked against RAG release metadata
- personal memory provider env is projected from `hindsight_llm` and
  `hindsight_embedding` active profiles into the Hindsight runtime. Retired
  `memory_graph_llm`, `personal_memory_extraction` and
  `personal_memory_embedding` profiles remain invalid.
- incompatible or unsupported roles return `{ "ok": false, "reason": "..." }`
  and app-api activation fails closed
