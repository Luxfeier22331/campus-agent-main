---
doc_type: contract
owner_boundary: apps/app-api
status: active
---

# App API 运行状态接口

## `GET /healthz`

只表示 Worker 可以响应，不检查依赖：

```json
{
  "status": "ok",
  "app": "app-api"
}
```

## `GET /readyz`

检查当前环境的必需配置、身份服务、数据库和 execution-control。成功示例：

```json
{
  "status": "ready",
  "dependencies": {
    "auth": "ready",
    "database": "ready",
    "executionRuntime": "ready",
    "ingestionControl": "not_configured",
    "operatorSurface": "configured",
    "authShellOrigin": "configured",
    "executionControl": "ready"
  },
  "preflight": {
    "executionRuntime": {
      "status": "ready",
      "checks": {
        "runProjectionStore": "ready",
        "temporalRuntime": "ready"
      },
      "blockers": {}
    },
    "campusServicesProductPath": {
      "status": "ready",
      "toolGate": "open",
      "projectionSource": "postgres",
      "checks": {
        "transportSchedule": "ready",
        "transportScheduleReadModel": "ready",
        "toolReadModelRuntime": "ready"
      },
      "blockers": {}
    }
  }
}
```

`dependencies.ingestionControl` 只表示是否配置 `INGESTION_CONTROL_BASE_URL`，不是对
ingestion-control 的完整健康检查。

`preflight.campusServicesProductPath` 是班车能力的独立检查。缺少有效班车版本时它可为
`blocked`，但不影响 app-api 其他产品路径就绪。已部署环境中，
`preflight.executionRuntime` 未就绪会阻止整体就绪。

必需配置缺失时返回 `503 dependency_not_ready`，并在 `details.missing` 中列出缺失键。
依赖检查失败时也返回 `503 dependency_not_ready`，并在 `details.failed` 中返回不含凭据的
失败摘要。

## 可执行来源

- `apps/app-api/src/app/routes/runtime.ts`
- `apps/app-api/src/app/readiness.ts`
- `apps/app-api/src/app/types.ts`
