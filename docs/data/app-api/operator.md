---
doc_type: data
owner_boundary: apps/app-api
status: active
---

# Operator Ingestion 数据

app-api 不拥有 source processing lifecycle table。operator ingestion 接口读取
ingestion-control 的有界投影：

```text
GET /api/operator/ingestion/tasks
-> ingestion-control /internal/ingestion/operator-projection/tasks
-> ingestion_control.tasks
```

响应包含 task/source/target identity、终态、时间、result 是否存在、有界 summary/error 和
Temporal workflow identity；不包含 object-store ref、原始来源、provider credential 或
Temporal history。

app-api 没有 official web、微信公众号、认证通知处理、source run、release task 或 collector
ledger table。在线请求诊断由 self-hosted Ops Web 的明确 PostgreSQL/OpenObserve 读取承担，
不在 `operator.*` 重建。

## 可执行来源

- `apps/app-api/src/app/routes/operator.ts`
- `apps/app-api/src/modules/integration/ingestion-control.ts`
- `apps/ingestion-control/src/postgres-store.ts`
