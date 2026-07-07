---
doc_type: contract
truth_scope: product
owner_boundary: apps/app-api
status: active
created: 2026-06-13
updated: 2026-06-13
---

# App API HTTP Operator

<!-- markdownlint-disable MD013 -->

## Operator Endpoints

### `GET /api/operator/requests`

查询参数：

- `limit`
- `cursor`
- `status`
- `surface`
- `conversationId`
- `requestId`

响应：

```json
{
  "requests": [],
  "page": {
    "nextCursor": null
  }
}
```

规则：

- 默认 `limit=20`
- 最大 `limit=100`
- 结果按 `startedAt desc`
- 只读取 `operator.request_projection`
- 不回放 answer execution

### `GET /api/operator/requests/:requestId`

响应：

```json
{
  "request": {
    "requestId": "req_01HQ...",
    "traceId": "trace_01HQ...",
    "surface": "campus_web",
    "conversationId": "conv_01HQ...",
    "status": "completed",
    "requestedTool": "knowledge_query",
    "requestedScope": {
      "corpus": "regulations",
      "collection": "student_rules"
    },
    "resolvedScope": {
      "corpus": "regulations",
      "collection": "student_rules"
    },
    "selectedTool": "knowledge_query",
    "questionPreview": "图书馆开放到几点？",
    "answerPreview": "图书馆开放到 22:00。",
    "errorCode": null,
    "sourceDocIds": ["handbook:library-hours"],
    "startedAt": "2026-03-28T07:10:30.000Z",
    "completedAt": "2026-03-28T07:10:31.000Z",
    "durationMs": 842,
    "projectedAt": "2026-03-28T07:10:31.500Z"
  }
}
```

规则：

- 这是 projection detail，不是 raw execution dump
- `requestedScope` 表示调用方显式请求的 knowledge tool scope，可为 `null`
- `resolvedScope` 表示 agent 最终解析并执行的 serving scope，是 operator/panel 侧的前向真相
- 细节页允许比 list 多出 `errorMessage`、`followUpQuestion`、`confidence` 或 `sourceDocIds`
- v1 不暴露 raw prompt、raw answer 全量、raw audit JSONL 或 agent-internal payload
