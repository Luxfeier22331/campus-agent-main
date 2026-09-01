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
    "requestId": null,
    "details": null
  }
}
```

| 字段 | 语义 |
| --- | --- |
| `code` | 稳定、使用 `snake_case` 的机器可读分类 |
| `message` | 面向调用方的简短说明，不包含内部响应或凭据 |
| `retryable` | 用户是否可以用相同业务输入新建一次请求；不是自动重放当前请求或底层工作流重试指令 |
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
状态和 `retryable` 由产生错误的路由或领域服务确定，浏览器不得按 HTTP 状态、错误码或字段缺失
自行推断。HTTP 错误 envelope 和准入后 `request.failed.error` 都必须显式提供布尔值；缺失时属于
合同错误。Temporal Activity 或 Workflow 是否重试是执行层的独立语义。

准入后的内部执行错误对产品只保留稳定分类：provider 错误映射为 `provider_unavailable`，执行超时
映射为 `execution_timeout`，明确的运行合同或身份不变量映射为 `runtime_invariant_failed`，其他合法
内部错误映射为 `run_failed`。产品分类不能反向覆盖执行层保存的原始失败代码。

## 聊天准入边界

- 准入前失败使用非 `2xx` HTTP 错误结构，不创建产品请求；
- 准入后的运行失败属于已存在请求的终态，通过同步答案结果或 SSE `request.failed` 表达；
- 已创建的请求保留同一个 `requestId`，不能改写为新的 HTTP 请求；
- 追问和资料边界说明是正常助手正文，不自动等于 HTTP 错误；执行层审批、拒绝和失败使用各自终态。

## 可执行来源

- `apps/app-api/src/http.ts`
- `apps/app-api/src/app/responses.ts`
- `apps/app-api/src/app/routes/`
- `apps/app-api/src/modules/runtime-command/service/errors.ts`
