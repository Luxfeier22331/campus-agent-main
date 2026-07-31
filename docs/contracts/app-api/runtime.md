---
doc_type: contract
owner_boundary: apps/app-api
status: active
---

# App API 运行状态

## `GET /healthz`

只表示 Worker 可以响应，不检查依赖：

```json
{
  "status": "ok",
  "app": "app-api"
}
```

## `GET /readyz`

检查 app-api 必需配置、认证和数据库。成功响应：

```json
{
  "status": "ready",
  "dependencies": {
    "auth": "ready",
    "database": "ready"
  }
}
```

规则：

- `auth` 和 `database` 为 `ready|not_ready`；
- Better Auth、数据库 binding 和其他必需配置缺失时，在依赖探测前失败；
- execution-control 的运行投影、Temporal 和工具状态由 execution-control 自己的 `/readyz` 拥有，
  App API 不把这些内部状态重新包装为产品 readiness；

必需配置缺失时返回 `503 dependency_not_ready`，`details.missing` 列出缺失配置。依赖检查失败
时同样返回 `503 dependency_not_ready`，`details.failed` 保存不含凭据的摘要，并可附带
`details.preflight`。

文档阅读器使用独立的 `GET /api/docs/readyz`，其结果不代表聊天执行运行时就绪。

## 可执行来源

- `apps/app-api/src/app/routes/runtime.ts`
- `apps/app-api/src/app/readiness.ts`
- `apps/app-api/src/app/types.ts`
- `apps/app-api/test/worker.test.ts`
