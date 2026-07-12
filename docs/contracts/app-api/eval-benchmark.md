---
doc_type: contract
truth_scope: eval
owner_boundary: apps/app-api
status: active
created: 2026-04-23
updated: 2026-07-11
---
# App API Eval Benchmark HTTP Contract

## 文档边界

这份文档冻结 `packages/eval-langfuse` 与其他 trusted automation 进入 `apps/app-api` 的
internal eval materialization ingress seam。旧 `packages/evals` package 已退役，不再作为
internal eval ingress caller。

它补充但不替代以下文档：

- browser-facing app contract：`docs/contracts/app-api/README.md`
- request lifecycle：`docs/contracts/app-api/request-lifecycle.md`
- `app-api -> execution-control`
  内部执行契约：`docs/contracts/tool-execution.md`
- operator observability ingest/query
  seam：`docs/contracts/app-api/observability.md`
- eval truth：`docs/reference/eval.md`

它不冻结：

- browser-facing `/api/chat/*` contract
- Operator Console query contract
- Langfuse dataset / run denominator
- provider/runtime threshold

## 适用范围

长期 internal eval materialization 调用形态固定为：

`packages/eval-langfuse / trusted automation -> POST /api/internal/evals/chat/requests
-> app-api -> execution-control path`

这里的目标是：

- 通过真实 `app-api` command path 执行 materialization request
- 返回 canonical `requestId` / `traceId`
- 可选返回 `execution` payload，供 Langfuse/Ragas dataset run 关联到 safe trace /
  observation projection
- 不创建 browser-facing BFF 或 same-site contract

## Admission Rules

- 调用方必须提供 `x-app-internal-auth`
- `x-app-internal-auth` 必须与 `APP_API_INTERNAL_SHARED_SECRET` 严格匹配
- 缺少或不匹配时固定返回 `401 service_credential_required`
- internal eval request 不调度 request projection drain；它只返回 command-path
  correlation truth
- request `surface` wire literal 固定写成 `eval_benchmark`，只作为 internal
  materialization surface marker

## Request Contract

### Endpoint

- `POST /api/internal/evals/chat/requests`

### Headers

必须：

- `content-type: application/json`
- `x-app-internal-auth`
- `x-eval-user-email`

可选 identity / actor 投影：

- `x-eval-user-id`
- `x-eval-user-name`
- `x-eval-principal-type`
- `x-eval-major`
- `x-eval-program`
- `x-eval-cohort`
- `x-eval-actor-roles`
- `x-eval-departments`
- `x-eval-entitlement-groups`
- `x-eval-entitlement-snapshot-id`
- `x-eval-visibility-level`
- `x-eval-visibility-scope`
- `x-eval-applicability-scope`
- `x-eval-ownership-scopes`

补充约束：

- `major` / `program` 等非 ASCII 值允许使用 `b64:<base64-utf8>` 形式传入
- `x-eval-principal-type` 只允许 `campus_member`、`student`、`staff`、`faculty`
- CSV header 继续按 shared parser 解析，例如 roles / departments / entitlement groups

### Body

最小 body：

```json
{
  "prompt": "图书馆开放到几点？"
}
```

带 scope 的 body：

```json
{
  "prompt": "图书馆开放到几点？",
  "requestedTool": "knowledge_query",
  "scope": "student_rules",
  "versionQuery": {
    "mode": "historical",
    "versionId": "v2024-student-rules"
  }
}
```

多轮 follow-up 时允许继续带：

- `conversationId`
- `versionQuery`

请求体以 public chat 的 `conversationId?` / `prompt` 为基础，并只在本
trusted route 增加：

- `surface = eval_benchmark`，作为 internal materialization marker
- identity 取自 internal eval headers，而不是 session principal
- `requestedTool` 是 trusted internal hint；app-api 只做字段规范化，最终 tool
  admission 由 execution-control runtime registry 决定
- `scope` 在 `requestedTool=knowledge_query` 时必填，且不能与其他 requested tool
  一起出现
- `versionQuery` 可选；app-api 将其规范化后放入 execution payload
- 非 `current` 的 eval case 通过同一条 `app-api` command path 进入
  execution-control

## Success Response

成功时固定返回：

- `200 OK`
- headers:
  - `x-request-id`
  - `x-trace-id`

response body：

```json
{
  "answer": {
    "conversation": {
      "id": "conv_eval_01HQ",
      "title": "图书馆开放时间",
      "createdAt": "2026-03-28T07:59:00.000Z",
      "updatedAt": "2026-03-28T08:00:01.000Z",
      "messages": []
    },
    "result": {
      "kind": "answer",
      "requestId": "req_eval_01HQ",
      "text": "图书馆开放到 22:00。",
      "traceId": "trace_eval_01HQ"
    }
  },
  "execution": {
    "status": "completed",
    "selectedTool": "knowledge_query",
    "traceId": "trace_eval_01HQ",
    "answerText": "图书馆开放到 22:00。",
    "followUpQuestion": "",
    "error": null,
    "observability": {
      "agentRuntime": "openai_agents_sdk",
      "selectedTools": ["knowledge_query"],
      "terminalReason": "answer"
    },
    "result": {
      "provider_response_id": "resp_eval_01HQ",
      "selected_tools": ["knowledge_query"],
      "sources": [
        {
          "canonical_url": "/docs/regulations/student_rules/library-hours",
          "snippet": "图书馆开放到 22:00。",
          "source_kind": "regulation",
          "source_title": "图书馆开放时间",
          "target_kind": "canonical_reader",
          "title": "图书馆开放时间",
          "version_id": "student-rules-current"
        }
      ],
      "terminal_reason": "answer"
    }
  }
}
```

补充约束：

- `answer` 与 browser-facing contract 保持同一 shape
- `execution` 是 eval-only internal payload；browser-facing app contract 不默认暴露它
- `requestId` / `traceId` 是 Langfuse/Ragas materialized dataset run 后续关联 trace /
  observation 的 canonical correlation truth

## Error Contract

- body validation 仍使用 shared error envelope：
  - `unsupported_media_type`
  - `invalid_json`
  - `validation_failed`
- internal auth 失败固定返回：
  - `service_credential_required`
- route/service-level 错误使用 route-error correlation 生成诊断用 `requestId` /
  `traceId`

## Lifecycle Notes

- internal eval ingress 通过真实 `app-api` command path 执行，不是直接调用 agent /
  execution shortcut
- 它服务 Langfuse/Ragas materialization、request correlation 与 safe trace observation
- 它不替代 active eval truth；Langfuse/Ragas lanes 与 fixture boundaries 见
  `docs/reference/eval.md`

## Retired Operator Eval Projection Publish

The former app-api eval coverage and Langfuse/Ragas diagnostic-badcase publish
seams are retired. `packages/eval-langfuse` no longer publishes coverage
snapshots or low-score candidate projections into app-api.

Current eval evidence flow is:

```text
Langfuse traces/datasets
-> packages/eval-langfuse safe projection
-> packages/ragas-runner upstream Ragas
-> packages/eval-langfuse publishes Langfuse scores / dataset run links
```

App-api remains the internal chat eval ingress for materialization requests and
request/trace correlation. It does not own eval scoring, coverage projection,
Ragas low-score candidate storage or golden-truth admission.
