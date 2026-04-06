---
doc_type: contract
status: active
created: 2026-03-28
updated: 2026-04-06
---

# App API Error Model

## 文档边界

这份文档冻结 `apps/app-api` 产品层 API 的统一错误 envelope 与 status-code 语义。

它补充但不替代以下文档：

- 产品层 HTTP contract：`docs/contracts/app-api-http.md`
- request lifecycle：`docs/contracts/app-api-request-lifecycle.md`
- execution contract：`docs/contracts/app-api-supervisor-execution.md`

## Error Envelope

所有 HTTP error response 统一返回：

```json
{
  "error": {
    "code": "validation_failed",
    "message": "prompt is required",
    "retryable": false,
    "traceId": "trace_01HQ...",
    "requestId": null,
    "details": null
  }
}
```

字段规则：

- `code`
  稳定机器可读错误码，使用 `snake_case`
- `message`
  面向人类的简短说明
- `retryable`
  是否推荐客户端自动或人工重试
- `traceId`
  runtime correlation id；如果请求在 HTTP 层被接受处理，则应尽量返回
- `requestId`
  只有在请求已经分配 canonical request identity 后才出现
- `details`
  可选结构化细节，例如字段校验失败列表

## HTTP Status Mapping

### `400 Bad Request`

用于：

- `invalid_json`
- `malformed_query`

### `401 Unauthorized`

用于：

- `unauthorized`
- `session_required`
- `session_expired`
- `internal_auth_required`
- `service_credential_required`

### `403 Forbidden`

用于：

- `forbidden`
- `operator_access_required`
- `operator_identity_not_admitted`

### `404 Not Found`

用于：

- `conversation_not_found`
- `request_not_found`

### `409 Conflict`

用于：

- `idempotency_conflict`
- `request_in_progress`

### `415 Unsupported Media Type`

用于：

- `unsupported_media_type`

### `422 Unprocessable Content`

用于：

- `validation_failed`

### `429 Too Many Requests`

用于：

- `rate_limited`

### `500 Internal Server Error`

用于：

- `internal_error`

### `502 Bad Gateway`

用于：

- `supervisor_unavailable`

### `503 Service Unavailable`

用于：

- `dependency_not_ready`

### `504 Gateway Timeout`

用于：

- `execution_timeout`

## Pre-Accept Vs Post-Accept

第一版固定区分：

- pre-accept failure
  返回 HTTP error envelope
- post-accept execution failure
  返回 `200`，并在 `POST /api/chat/requests` 的 `answer.result.kind=error` 中表达

示例：

- prompt 为空
  `422 validation_failed`
- conversation 不属于当前 user
  `404 conversation_not_found`
- 幂等键冲突
  `409 idempotency_conflict`
- supervisor 在请求已 durable 接受后失败
  `200 + result.kind=error`

## Domain Codes

### Auth / Admission

- `unauthorized`
- `session_required`
- `session_expired`
- `internal_auth_required`
- `service_credential_required`
- `forbidden`
- `operator_access_required`
- `operator_identity_not_admitted`

### Request Validation

- `invalid_json`
- `unsupported_media_type`
- `validation_failed`
- `conversation_not_found`
- `request_not_found`

### Idempotency

- `idempotency_conflict`
- `request_in_progress`

### Dependency / Runtime

- `dependency_not_ready`
- `supervisor_unavailable`
- `execution_timeout`
- `internal_error`

## Retry Rule

默认建议：

- `retryable=false`
  认证失败、权限失败、校验失败、ownership 失败、幂等冲突
- `retryable=true`
  上游临时不可用、超时、短暂依赖故障

对于 `POST /api/chat/requests` 的 post-accept execution failure：

- `retryable` 通过 `answer.result.retryable` 返回
- 同时保留 `requestId` 与 `traceId`

## Non-Goals

- 不把 `no_answer` 当作 HTTP error
- 不把 operator projection eventual consistency 暴露成 transport exception taxonomy
- 不要求所有 dependency failure 都映射为同一个 `500`
