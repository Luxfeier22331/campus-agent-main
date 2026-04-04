---
doc_type: contract
status: active
created: 2026-03-28
updated: 2026-04-03
---

# App API Supervisor Execution Contract

## 文档边界

这份文档冻结 shared `apps/app-api` 调用 `apps/supervisor-api` 的内部执行契约。

它补充但不替代以下文档：

- shared product topology：`docs/architecture/product-runtime-architecture.md`
- `app-api` runtime 边界：`docs/architecture/product-runtime-architecture.md`
- supervisor execution engine 边界：`docs/architecture/execution-and-specialists-architecture.md`
- 产品层 HTTP contract：`docs/contracts/app-api-http.md`
- request lifecycle：`docs/contracts/app-api-request-lifecycle.md`
- execution admission ownership：`docs/decisions/adr-0017-supervisor-internal-execution-admission.md`

这份文档不冻结：

- `packages/contracts` 中 specialist payload 的全部字段
- execution engine runtime 必须采用哪种 Python/HTTP 框架
- public entry Worker 对 `apps/supervisor-api` 的现有 Cloudflare ingress contract

## 设计原则

长期执行链路固定为：

`public-chat-web -> app-api -> supervisor-api -> packages/supervisor-core -> specialist`

这里的关键规则只有三条：

- browser 永远不直接使用这份 contract
- `app-api` 负责产品层 auth/session/principal mapping，并把 execution-side `actor` 显式传给 `supervisor-api`
- `supervisor-api` 继续只是 execution engine，只做 internal caller admission，不重新吸收产品层 auth/session/conversation

## Transport Conclusion

第一版固定复用现有 execution endpoint：

- `POST /api/v1/answer`
- `GET /healthz`
- `GET /readyz`

这里需要区分两件事：

- 当前复用 `/api/v1/answer` 是兼容现有实现的 transport 选择
- forward canonical seam 是 `app-api -> supervisor-api` 的 internal execution contract，而不是 browser-facing public API

后续如果为了收口边界而把 transport 迁移到 dedicated internal execution endpoint，不会改变本文冻结的 request/response 语义。

JSON 命名保持 `snake_case`，原因如下：

- 当前 `apps/supervisor-api` 已以 Python-side `SupervisorRequest` / `SupervisorResponse` 为真相
- 这里是 internal execution seam，不是 browser product API
- 这样可以减少 `app-api -> supervisor-api` 之间的翻译噪音

## Required Request Headers

- `content-type: application/json`
- `x-trace-id: <trace-id>`
- `x-worker-origin-auth: <shared-secret-or-equivalent>`

规则：

- `x-trace-id` 由 `app-api` 生成并负责透传
- `x-worker-origin-auth` 是 execution-side internal caller admission 头；`app-api` 第一版可以直接复用这个名字
- `cf-access-jwt-assertion` 不是 shared `app-api` 调用 `supervisor-api` 的长期 contract 一部分

## Request Body

最小请求体如下：

```json
{
  "request_id": "req_01HQ...",
  "conversation_id": "conv_01HQ...",
  "user_goal": "图书馆开放到几点？",
  "context": {
    "actor": {
      "user_id": "user_01HQ...",
      "principal_id": "principal_01HQ...",
      "roles": ["student"],
      "departments": []
    },
    "authorization": {
      "principal_id": "principal_01HQ...",
      "entitlement_groups": ["students"],
      "visibility_scope": "main",
      "retrieval_filter": {
        "entitlement_groups": ["students"],
        "visibility_level": "public",
        "visibility_scope": "main",
        "policy_projection_version": "phase1-authorization-projection-v1"
      }
    },
    "profile_memory": {
      "items": []
    },
    "session": {
      "confirmed_slots": [],
      "turn_count": 0
    }
  },
  "requested_capability": "knowledge"
}
```

字段说明：

- `request_id`
  来自 `app-api` 分配的 canonical request identity
- `conversation_id`
  来自 chat domain truth
- `user_goal`
  来自产品层 prompt
- `context`
  由 `app-api` 显式投影的最小 `ContextProjection`；当前至少包含 `actor`、`authorization.retrieval_filter`、空的 `profile_memory.items` 与 `session.confirmed_slots`，以及 turn count 摘要
- `requested_capability`
  当前允许 `knowledge` 或 `availability`
- `requested_scope`
  可选；如果上游已经显式约束 serving surface，则传入这个字段。若缺失，execution path 必须允许 specialist 自主解析最终 serving surface，而不是由 `app-api` 或 `supervisor-core` 伪造默认 collection
- `availability_target_id` / `follow_redirects`
  仅在 availability execution 时出现

## Response Body

`supervisor-api` 返回的最小成功 body 继续对齐 `SupervisorResponse + trace_id`：

```json
{
  "selected_target": "rag-specialist",
  "status": "completed",
  "answer_text": "图书馆开放到 22:00。",
  "follow_up_question": "",
  "confidence": "high",
  "result": null,
  "error": null,
  "observability": {
    "retrieval_attempted": true,
    "candidate_count": 2,
    "retrieved_source_count": 2,
    "citation_expected": true,
    "citation_count": 2,
    "citation_missing": false,
    "resolved_scope_corpus": "regulations",
    "resolved_scope_collection": "student_handbook",
    "refusal_class": "",
    "acl_decision": "allowed",
    "fail_closed": false
  },
  "trace_id": "trace_01HQ..."
}
```

`status` 固定允许：

- `completed`
- `needs_clarification`
- `no_answer`
- `error`
- `approval_required`
- `rejected`

`app-api` 依赖的最小字段只有：

- `status`
- `trace_id`
- `selected_target`
- `answer_text`
- `follow_up_question`
- `error`
- `result`
- `observability` optional

其中：

- `result` 仍由 specialist / shared contract 拥有，不在这里完整重定义
- `app-api` 可以从 `result` 中提取 source identifiers 进入 projection，但不得把 specialist payload 直接当 browser contract 暴露
- `observability` 是 execution-side typed summary seam，用于 `runtime.request_observability_fact` 的 seed / finalize；字段继续保持 Python-side `snake_case`
- 当 execution side 解析了最终 serving surface 时，`observability.resolved_scope_*` 必须显式回传给 `app-api`
- `observability` 不返回 raw prompt、raw answer、raw transcript、raw retrieval payload 或 raw auth material
- token / model / cost 字段如果出现，必须来自 execution-side typed telemetry seam，而不是 panel-side 或 sink-side 反推

## HTTP Status Rule

对 `app-api` 来说，需要区分两类失败：

- transport / admission / malformed execution request
  使用非 `200`
- execution 已被受理并得到 typed `SupervisorResponse`
  返回 `200`，由 body 内 `status` 区分 `completed` / `needs_clarification` / `no_answer` / `error` / `approval_required` / `rejected`

这意味着：

- `app-api` 应把 `200 + status=error` 视为 execution-level handled outcome
- `app-api` 应保留 `approval_required` / `rejected` 作为 runtime / panel projection 的最终状态，即使 browser chat surface 折叠为 `error`
- `app-api` 不应把所有非理想执行结果都折叠成 transport error

## Current Compatibility Note

当前仓库里的 `apps/supervisor-api` 仍保留 `bearer` / `trusted-worker` admission mode，但 shared product path 已收口为：

- internal caller admission 继续由 runtime header 保证
- `context` 由 `app-api` 显式提供，并携带最终 `actor` 与 `authorization`
- `trusted-worker` 不再依赖 Cloudflare Access JWT 或 edge identity header 来恢复最终业务 actor
- top-level `actor` 不是 canonical request body 的必需字段；如果出现在 trusted-worker 请求里，只能作为与 `context.actor` 一致的冗余投影

这不重开 `packages/contracts`，因为 `ActorContext` 本身已经是 accepted shared contract。

## Non-Goals

- 不把 panel query 做进 `supervisor-api`
- 不让 `supervisor-api` 理解 Better Auth session 或 operator trusted-access provider 细节
- 不把 public entry Worker 的外部 ingress contract 直接复制为 shared `app-api` 的内部 execution contract
