---
doc_type: contract
status: active
created: 2026-03-28
updated: 2026-03-29
---

# App API Supervisor Execution Contract

## 文档边界

这份文档冻结 shared `apps/app-api` 调用 `apps/supervisor-api` 的内部执行契约。

它补充但不替代以下文档：

- shared product topology：`docs/architecture/shared-app-api-and-worker-web-surfaces.md`
- `app-api` runtime 边界：`docs/architecture/app-api-architecture.md`
- supervisor execution engine 边界：`docs/architecture/supervisor-architecture.md`
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

- 当前 `apps/supervisor-api` 已以 Python-side `SupervisorRequest` / `SpecialistResponse` 为真相
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
  "actor": {
    "user_id": "user_01HQ...",
    "roles": ["student"],
    "departments": [],
    "groups": ["students"],
    "campus_scope": "main",
    "snapshot": {
      "principal_type": "public_user"
    }
  },
  "requested_capability": "knowledge",
  "requested_scope": {
    "corpus": "regulations",
    "collection": "student_handbook"
  }
}
```

字段说明：

- `request_id`
  来自 `app-api` 分配的 canonical request identity
- `conversation_id`
  来自 chat domain truth
- `user_goal`
  来自产品层 prompt
- `actor`
  由 `app-api` 从 session / trusted operator identity 映射而来，对齐 `packages/contracts.ActorContext`
- `requested_capability`
  当前允许 `knowledge` 或 `availability`
- `requested_scope`
  当前用于知识问答范围约束
- `availability_target_id` / `follow_redirects`
  仅在 availability execution 时出现

## Response Body

`supervisor-api` 返回的最小成功 body 继续对齐 `SpecialistResponse + trace_id`：

```json
{
  "target": "rag-specialist",
  "status": "completed",
  "answer_text": "图书馆开放到 22:00。",
  "follow_up_question": "",
  "confidence": "high",
  "result": null,
  "error": null,
  "trace_id": "trace_01HQ..."
}
```

`status` 固定允许：

- `completed`
- `needs_clarification`
- `no_answer`
- `error`

`app-api` 依赖的最小字段只有：

- `status`
- `trace_id`
- `target`
- `answer_text`
- `follow_up_question`
- `error`
- `result`

其中：

- `result` 仍由 specialist / shared contract 拥有，不在这里完整重定义
- `app-api` 可以从 `result` 中提取 source identifiers 进入 projection，但不得把 specialist payload 直接当 browser contract 暴露

## HTTP Status Rule

对 `app-api` 来说，需要区分两类失败：

- transport / admission / malformed execution request
  使用非 `200`
- execution 已被受理并得到 typed `SpecialistResponse`
  返回 `200`，由 body 内 `status` 区分 `completed` / `needs_clarification` / `no_answer` / `error`

这意味着：

- `app-api` 应把 `200 + status=error` 视为 execution-level handled outcome
- `app-api` 不应把所有非理想执行结果都折叠成 transport error

## Current Compatibility Note

当前仓库里的 `apps/supervisor-api` 仍主要通过 bearer / trusted-worker header 来构造 `SupervisorRequest.actor`。

shared `app-api` 落地时，需要把 execution-side caller contract 收口为：

- internal caller admission 仍由 runtime header 保证
- `actor` 由 `app-api` 显式提供
- `supervisor-api` 不再依赖 Cloudflare Access JWT 或 edge identity header 来恢复最终业务 actor

因此：

- `bearer` / `trusted-worker` 是当前实现与本地调试的 compatibility ingress
- 它们不是 forward product identity ownership 的长期依据

这不重开 `packages/contracts`，因为 `ActorContext` 本身已经是 accepted shared contract。

## Non-Goals

- 不把 panel query 做进 `supervisor-api`
- 不让 `supervisor-api` 理解 Better Auth session 或 operator trusted-access provider 细节
- 不把 public entry Worker 的外部 ingress contract 直接复制为 shared `app-api` 的内部 execution contract
