---
doc_type: contract
owner_boundary: apps/app-api
status: active
---

# Operator Ingestion 接口

`GET /api/operator/ingestion/tasks` 要求 operator principal，并把已校验的 source、target、
registry task、run、status 和 limit 过滤条件转发给 ingestion-control 的有界运维投影。

该接口只读，不创建、取消、重试或修改 ingestion task。无效参数使用 app-api 共享错误 envelope。
响应不得包含原始来源正文、对象存储 ref、provider credential、Temporal history 或数据库所有者
字段。

app-api 不提供 authenticated notice processing、official-web release task 或 WeChat collector
运维接口。

## 可执行来源

- `apps/app-api/src/app/routes/operator.ts`
- `apps/app-api/src/modules/integration/ingestion-control.ts`
- `docs/data/app-api/operator.md`
