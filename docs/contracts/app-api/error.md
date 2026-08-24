---
doc_type: contract
owner_boundary: apps/app-api
status: active
---

# App API 错误

## 边界

本文定义 App API 共享错误结构与通用 HTTP 语义。每个领域接口的专用错误码由所属合同和路由
测试维护；本文不建立一份容易与实现漂移的全仓错误码清单。

## 错误结构

HTTP 错误统一返回：

```json
{
  "error": {
    "code": "validation_failed",
    "message": "prompt is required.",
    "retryable": false,
    "traceId": "trace_01",
    "requestId": null,
    "details": null
  }
}
```

| 字段 | 语义 |
| --- | --- |
| `code` | 稳定、使用 `snake_case` 的机器可读分类 |
| `message` | 面向调用方的简短说明，不包含内部响应或凭据 |
| `retryable` | 调用方是否可以在不修改请求的情况下重试 |
| `traceId` | 已建立请求 trace 时返回的关联标识 |
| `requestId` | 已分配产品请求标识时返回，否则为 `null` |
| `details` | 可选的有界结构化信息，不接受任意异常对象 |

## HTTP 语义

- `400`：JSON、查询或请求结构无法解析；
- `401`：缺少或无效的 session、内部认证或服务凭据；
- `403`：身份有效但无权执行该操作；
- `404`：当前调用方不可见的资源；
- `409`：幂等键、当前状态或并发写入冲突；
- `415`：请求媒体类型不受支持；
- `422`：请求可以解析但字段语义无效；
- `429`：速率或配额限制；
- `500`：仓库自身不变量失败；
- `502`：内部上游返回无效响应或暂时不可达；
- `503`：运行依赖尚未就绪；
- `504`：内部调用超过期限。

认证、权限和校验失败通常不可重试；短暂上游故障、依赖未就绪与超时可以标记为可重试。具体
状态和 `retryable` 由产生错误的路由或领域服务确定，浏览器不得自行推断。

## 聊天准入边界

- 准入前失败使用非 `2xx` HTTP 错误结构，不创建产品请求；
- 准入后的运行失败属于已存在请求的终态，通过同步答案结果或 SSE `request.failed` 表达；
- 已创建的请求保留 `requestId`、`traceId` 与 run 关联，不能改写为新的 HTTP 请求；
- 追问和资料边界说明是正常助手正文，不自动等于 HTTP 错误；执行层审批、拒绝和失败使用各自终态。

## 可执行来源

- `apps/app-api/src/http.ts`
- `apps/app-api/src/app/responses.ts`
- `apps/app-api/src/app/routes/`
- `apps/app-api/src/modules/runtime-command/service/errors.ts`
