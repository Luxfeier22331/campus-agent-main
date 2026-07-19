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

检查 app-api 必需配置、认证、数据库和 execution-control。成功响应：

```json
{
  "status": "ready",
  "dependencies": {
    "auth": "ready",
    "authShellOrigin": "configured",
    "database": "ready",
    "executionControl": "ready",
    "executionRuntime": "ready"
  },
  "preflight": {
    "executionRuntime": {
      "status": "ready",
      "runtimeRelease": "<release>",
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

规则：

- `auth`、`database` 和 `executionControl` 为 `ready|not_ready`；
- `authShellOrigin` 固定为 `configured`，缺少配置会在检查前返回错误；
- `executionRuntime` 在已部署环境为 `ready|not_ready`，其他环境可以为 `not_required`；
- `preflight.executionRuntime` 报告运行投影与 Temporal，并可携带 `runtimeRelease`；
- `preflight.campusServicesProductPath` 是班车产品路径的独立状态，阻塞时不影响其他产品能力；
- `preflight` 没有内容时可以省略。

必需配置缺失时返回 `503 dependency_not_ready`，`details.missing` 列出缺失配置。依赖检查失败
时同样返回 `503 dependency_not_ready`，`details.failed` 保存不含凭据的摘要，并可附带
`details.preflight`。

文档阅读器使用独立的 `GET /api/docs/readyz`，其结果不代表聊天执行运行时就绪。

## 可执行来源

- `apps/app-api/src/app/routes/runtime.ts`
- `apps/app-api/src/app/readiness.ts`
- `apps/app-api/src/app/types.ts`
- `apps/app-api/test/worker.test.ts`
